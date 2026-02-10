import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

const isMissingTableError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "P2021";

const trimText = (value: string, max = 280) => value.replace(/\s+/g, " ").trim().slice(0, max);

const parseRubric = (raw: string | null) => {
  if (!raw) return "None";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1000);
    }
  } catch {
    // fall through
  }
  return raw.slice(0, 1000);
};

const normalizeTypedResponse = (raw: string) => {
  const text = raw.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { selection?: unknown; explain?: unknown } | unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as { selection?: unknown; explain?: unknown };
      const parts: string[] = [];
      if (Array.isArray(record.selection)) {
        const values = record.selection.map((item) => String(item || "").trim()).filter(Boolean);
        if (values.length) parts.push(`selection: ${values.join(", ")}`);
      } else if (typeof record.selection === "string" && record.selection.trim()) {
        parts.push(`selection: ${record.selection.trim()}`);
      }
      if (typeof record.explain === "string" && record.explain.trim()) {
        parts.push(`explain: ${record.explain.trim()}`);
      }
      if (parts.length) return parts.join(" | ");
    }
  } catch {
    // plain text response
  }
  return text;
};

const hasSubstantiveEvidence = (context: {
  responseText: string;
  drawingText: string;
}) => !!normalizeTypedResponse(context.responseText) || !!context.drawingText.trim();

const completeSummary = async ({
  baseUrl,
  apiKey,
  model,
  system,
  user,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
}) => {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Lesson summary API error:", errorText);
    throw new Error(errorText || "Summary request failed");
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
};

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const slideId = body?.slideId as string | undefined;
  const studentId = body?.studentId as string | undefined;

  if (!sessionId || (!slideId && !studentId)) {
    return new NextResponse("Missing sessionId and target", { status: 400 });
  }

  const lessonSession = await prisma.lessonSession.findUnique({
    where: { id: sessionId },
    include: { lesson: true },
  });
  if (!lessonSession) {
    return new NextResponse("Lesson session not found", { status: 404 });
  }

  const config = await prisma.appConfig.findFirst();
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  let baseUrl = config?.baseUrl || "https://api.deepseek.com";
  if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  if (baseUrl.endsWith("/v1")) baseUrl = baseUrl.slice(0, -3);
  if (!apiKey) {
    return new NextResponse("Missing API Key", { status: 500 });
  }

  const slides = await prisma.lessonSlide.findMany({
    where: { lessonId: lessonSession.lessonId },
    select: { id: true, index: true },
  });
  const slideIndexMap = new Map(slides.map((s) => [s.id, s.index]));
  const model = config?.model || "deepseek-chat";

  if (slideId) {
    const [slide, responses, studentStates] = await Promise.all([
      prisma.lessonSlide.findUnique({ where: { id: slideId } }),
      prisma.lessonResponse.findMany({
        where: { sessionId, slideId },
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.lessonStudentSlideState
        .findMany({
          where: { sessionId, slideId },
          include: { user: true },
          orderBy: { updatedAt: "desc" },
        })
        .catch((err) => {
          if (isMissingTableError(err)) return [];
          throw err;
        }),
    ]);

    type StudentContext = {
      name: string;
      responseText: string;
      drawingText: string;
      drawingPath: string;
      updatedAt: Date;
    };
    const contextByUser = new Map<string, StudentContext>();

    for (const response of responses) {
      contextByUser.set(response.userId, {
        name: response.user?.name || response.user?.email || "Student",
        responseText: response.response || "",
        drawingText: "",
        drawingPath: response.drawingPath || "",
        updatedAt: response.updatedAt,
      });
    }

    for (const state of studentStates) {
      const existing = contextByUser.get(state.userId);
      if (existing && existing.updatedAt > state.updatedAt) continue;
      contextByUser.set(state.userId, {
        name: state.user?.name || state.user?.email || existing?.name || "Student",
        responseText: state.responseText || existing?.responseText || "",
        drawingText: state.drawingText || "",
        drawingPath: state.drawingPath || existing?.drawingPath || "",
        updatedAt: state.updatedAt,
      });
    }

    const contexts = Array.from(contextByUser.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );

    const substantiveContexts = contexts.filter(hasSubstantiveEvidence);
    const textCount = contexts.filter((c) => normalizeTypedResponse(c.responseText).length > 0).length;
    const drawingTextCount = contexts.filter((c) => c.drawingText.trim().length > 0).length;
    const artifactOnlyCount = contexts.filter(
      (c) => !!c.drawingPath && !c.responseText.trim() && !c.drawingText.trim()
    ).length;
    const emptyCount = contexts.length - substantiveContexts.length - artifactOnlyCount;

    const textSamples = substantiveContexts.slice(0, 16).map((context) => {
      const parts: string[] = [];
      const normalizedTypedResponse = normalizeTypedResponse(context.responseText);
      if (normalizedTypedResponse) {
        parts.push(`typed: ${trimText(normalizedTypedResponse, 220)}`);
      }
      if (context.drawingText.trim()) {
        parts.push(`drawing text: ${trimText(context.drawingText, 220)}`);
      }
      return `- ${context.name}: ${parts.join(" | ") || "No work yet"}`;
    });

    const system = `You summarize a class's progress on a single slide.
Output 4-6 bullet points. Focus on common misconceptions, progress, and who might need help.
Do not reveal final answers. Do not include student names. If there's not enough data, say so plainly.
Treat image-only artifacts (drawing path with no typed/drawing text) as non-evidence.
Do not infer understanding, participation, or misconceptions from artifact-only entries.
Keep it concise and teacher-friendly.`;

    const user = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Slide index: ${slideIndexMap.get(slideId) || "?"}`,
      `Slide prompt: ${slide?.prompt ? slide.prompt.slice(0, 600) : "None"}`,
      `Slide text: ${slide?.text ? slide.text.slice(0, 600) : "None"}`,
      `Rubric: ${parseRubric(slide?.rubric || null)}`,
      `Response type: ${slide?.responseType || "text"}`,
      `Total students seen: ${contexts.length}`,
      `Students with substantive evidence: ${substantiveContexts.length}`,
      `Text responses: ${textCount}`,
      `Drawing text snippets: ${drawingTextCount}`,
      `Artifact-only entries (image path without text evidence): ${artifactOnlyCount}`,
      `No-evidence entries: ${emptyCount}`,
      `Sample evidence:`,
      ...(textSamples.length ? textSamples : ["- (No substantive evidence yet)"]),
    ].join("\n");

    let summary = "";
    try {
      summary = await completeSummary({ baseUrl, apiKey, model, system, user });
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "";
      return new NextResponse(message || "Summary request failed", { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  }

  if (studentId) {
    const [responses, studentStates] = await Promise.all([
      prisma.lessonResponse.findMany({
        where: { sessionId, userId: studentId },
        include: { user: true, slide: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.lessonStudentSlideState
        .findMany({
          where: { sessionId, userId: studentId },
          include: { user: true, slide: true },
          orderBy: { updatedAt: "desc" },
        })
        .catch((err) => {
          if (isMissingTableError(err)) return [];
          throw err;
        }),
    ]);

    type SlideContext = {
      slideId: string;
      slideIndex: number;
      prompt: string;
      responseText: string;
      drawingText: string;
      drawingPath: string;
      updatedAt: Date;
      name: string;
    };
    const contextBySlide = new Map<string, SlideContext>();

    for (const response of responses) {
      const idx = slideIndexMap.get(response.slideId) || response.slide?.index || 0;
      contextBySlide.set(response.slideId, {
        slideId: response.slideId,
        slideIndex: idx,
        prompt: response.slide?.prompt || "",
        responseText: response.response || "",
        drawingText: "",
        drawingPath: response.drawingPath || "",
        updatedAt: response.updatedAt,
        name: response.user?.name || response.user?.email || "Student",
      });
    }

    for (const state of studentStates) {
      const existing = contextBySlide.get(state.slideId);
      if (existing && existing.updatedAt > state.updatedAt) continue;
      const idx = slideIndexMap.get(state.slideId) || state.slide?.index || existing?.slideIndex || 0;
      contextBySlide.set(state.slideId, {
        slideId: state.slideId,
        slideIndex: idx,
        prompt: state.slide?.prompt || existing?.prompt || "",
        responseText: state.responseText || existing?.responseText || "",
        drawingText: state.drawingText || "",
        drawingPath: state.drawingPath || existing?.drawingPath || "",
        updatedAt: state.updatedAt,
        name: state.user?.name || state.user?.email || existing?.name || "Student",
      });
    }

    const contexts = Array.from(contextBySlide.values())
      .sort((a, b) => a.slideIndex - b.slideIndex || b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 16);
    const substantiveContexts = contexts.filter(hasSubstantiveEvidence);
    const artifactOnlyCount = contexts.filter(
      (c) => !!c.drawingPath && !c.responseText.trim() && !c.drawingText.trim()
    ).length;

    const name =
      contexts[0]?.name ||
      responses[0]?.user?.name ||
      responses[0]?.user?.email ||
      studentStates[0]?.user?.name ||
      studentStates[0]?.user?.email ||
      "Student";
    const samples = substantiveContexts.map((context) => {
      const parts: string[] = [];
      const normalizedTypedResponse = normalizeTypedResponse(context.responseText);
      if (normalizedTypedResponse) parts.push(`typed: ${trimText(normalizedTypedResponse, 180)}`);
      if (context.drawingText.trim()) parts.push(`drawing text: ${trimText(context.drawingText, 180)}`);
      return `- Slide ${context.slideIndex || "?"} (prompt: ${trimText(context.prompt || "No prompt", 140)}): ${parts.join(" | ") || "no work yet"}`;
    });

    const system = `You summarize a single student's progress across multiple slides.
Output 4-6 bullet points. Focus on strengths, misconceptions, and next steps.
Do not reveal final answers. Keep it concise and teacher-friendly.
Treat image-only artifacts (drawing path with no typed/drawing text) as non-evidence.
Do not infer understanding, participation, or misconceptions from artifact-only entries.`;

    const user = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Student: ${name}`,
      `Total observed slides: ${contexts.length}`,
      `Slides with substantive evidence: ${substantiveContexts.length}`,
      `Artifact-only slides (image path without text evidence): ${artifactOnlyCount}`,
      `Recent evidence:`,
      ...(samples.length ? samples : ["- (No substantive evidence yet)"]),
    ].join("\n");

    let summary = "";
    try {
      summary = await completeSummary({ baseUrl, apiKey, model, system, user });
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "";
      return new NextResponse(message || "Summary request failed", { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  }

  return new NextResponse("Invalid request", { status: 400 });
}
