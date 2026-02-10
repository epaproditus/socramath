import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";

type AssessmentLabel = "green" | "yellow" | "red" | "grey";

type StudentContext = {
  userId: string;
  name: string;
  responseText: string;
  drawingText: string;
  drawingPath: string;
  updatedAt: Date;
};

type Rating = {
  studentId: string;
  label: AssessmentLabel;
  reason: string;
};

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
    // plain text
  }
  return text;
};

const parseJsonObject = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch?.[1]) {
    candidates.unshift(codeFenceMatch[1].trim());
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.unshift(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // continue
    }
  }
  return null;
};

const sanitizeLabel = (value: unknown): AssessmentLabel => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "green" || normalized === "yellow" || normalized === "red" || normalized === "grey") {
    return normalized;
  }
  if (normalized === "gray") return "grey";
  return "yellow";
};

const isMissingTableError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "P2021";

const ensureAssessmentTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LessonCellAssessment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "slideId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "reason" TEXT,
      "source" TEXT NOT NULL DEFAULT 'llm',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "LessonCellAssessment_sessionId_slideId_userId_key"
    ON "LessonCellAssessment"("sessionId","slideId","userId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "LessonCellAssessment_sessionId_idx"
    ON "LessonCellAssessment"("sessionId")
  `);
};

const upsertAssessment = async ({
  sessionId,
  slideId,
  userId,
  label,
  reason,
}: {
  sessionId: string;
  slideId: string;
  userId: string;
  label: AssessmentLabel;
  reason: string;
}) => {
  const now = Date.now();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "LessonCellAssessment"
      ("id","sessionId","slideId","userId","label","reason","source","createdAt","updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, 'llm', ?, ?)
      ON CONFLICT("sessionId","slideId","userId")
      DO UPDATE SET
        "label"=excluded."label",
        "reason"=excluded."reason",
        "source"='llm',
        "updatedAt"=excluded."updatedAt"
    `,
    crypto.randomUUID(),
    sessionId,
    slideId,
    userId,
    label,
    reason,
    now,
    now
  );
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
  if (!sessionId || !slideId) {
    return new NextResponse("Missing sessionId or slideId", { status: 400 });
  }

  const lessonSession = await prisma.lessonSession.findUnique({
    where: { id: sessionId },
    include: { lesson: true },
  });
  if (!lessonSession) return new NextResponse("Lesson session not found", { status: 404 });

  const slide = await prisma.lessonSlide.findUnique({ where: { id: slideId } });
  if (!slide || slide.lessonId !== lessonSession.lessonId) {
    return new NextResponse("Slide not found for session lesson", { status: 404 });
  }

  const [responses, studentStates] = await Promise.all([
    prisma.lessonResponse.findMany({
      where: {
        sessionId,
        slideId,
        ...(studentId ? { userId: studentId } : {}),
      },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.lessonStudentSlideState
      .findMany({
        where: {
          sessionId,
          slideId,
          ...(studentId ? { userId: studentId } : {}),
        },
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      })
      .catch((err) => {
        if (isMissingTableError(err)) return [];
        throw err;
      }),
  ]);

  const contextByUser = new Map<string, StudentContext>();
  for (const response of responses) {
    contextByUser.set(response.userId, {
      userId: response.userId,
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
      userId: state.userId,
      name: state.user?.name || state.user?.email || existing?.name || "Student",
      responseText: state.responseText || existing?.responseText || "",
      drawingText: state.drawingText || "",
      drawingPath: state.drawingPath || existing?.drawingPath || "",
      updatedAt: state.updatedAt,
    });
  }

  const contexts = Array.from(contextByUser.values());
  if (!contexts.length) {
    return NextResponse.json({ ok: true, updated: 0, assessments: [] });
  }

  await ensureAssessmentTable();

  const autoGrey: Rating[] = [];
  const evaluable = contexts
    .map((context) => {
      const typed = normalizeTypedResponse(context.responseText);
      const drawing = context.drawingText.trim();
      const evidence = [typed ? `typed: ${typed}` : "", drawing ? `drawing text: ${drawing}` : ""]
        .filter(Boolean)
        .join(" | ");
      if (!evidence) {
        autoGrey.push({
          studentId: context.userId,
          label: "grey",
          reason: "No substantive evidence yet.",
        });
      }
      return {
        studentId: context.userId,
        name: context.name,
        evidence,
      };
    })
    .filter((entry) => !!entry.evidence);

  let llmRatings: Rating[] = [];
  if (evaluable.length) {
    const config = await prisma.appConfig.findFirst();
    const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
    if (!apiKey) return new NextResponse("Missing API Key", { status: 500 });
    let baseUrl = config?.baseUrl || "https://api.deepseek.com";
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    if (baseUrl.endsWith("/v1")) baseUrl = baseUrl.slice(0, -3);

    const system = `You evaluate student understanding for one slide.
Return strict JSON only:
{"ratings":[{"studentId":"string","label":"green|yellow|red","reason":"string"}]}
Rubric:
- green: evidence shows solid understanding aligned with rubric.
- yellow: partial understanding or unclear/incomplete reasoning.
- red: likely misconception or incorrect understanding.
Rules:
- Use only provided evidence.
- Never use names in reason.
- Keep reason under 20 words.
- Do not output markdown.`;

    const userPrompt = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Slide index: ${slide.index}`,
      `Slide prompt: ${trimText(slide.prompt || "None", 600)}`,
      `Slide text: ${trimText(slide.text || "None", 600)}`,
      `Rubric: ${parseRubric(slide.rubric || null)}`,
      "Evidence by student:",
      ...evaluable.map((entry) => `- ${entry.studentId}: ${trimText(entry.evidence, 500)}`),
    ].join("\n");

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config?.model || "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new NextResponse(errorText || "Assessment request failed", { status: 500 });
    }

    const llmData = await response.json();
    const content = String(llmData?.choices?.[0]?.message?.content || "").trim();
    const parsed = parseJsonObject(content);
    const ratings = Array.isArray(parsed?.ratings) ? (parsed?.ratings as unknown[]) : [];
    const ratingByStudent = new Map<string, Rating>();
    for (const item of ratings) {
      if (!item || typeof item !== "object") continue;
      const row = item as { studentId?: unknown; label?: unknown; reason?: unknown };
      const sid = String(row.studentId || "").trim();
      if (!sid) continue;
      ratingByStudent.set(sid, {
        studentId: sid,
        label: sanitizeLabel(row.label),
        reason: trimText(String(row.reason || "").trim() || "Assessment generated.", 200),
      });
    }

    llmRatings = evaluable.map((entry) => {
      const found = ratingByStudent.get(entry.studentId);
      if (found) return found;
      return {
        studentId: entry.studentId,
        label: "yellow",
        reason: "Partial evidence; needs clearer reasoning.",
      };
    });
  }

  const finalRatings = [...autoGrey, ...llmRatings];
  for (const rating of finalRatings) {
    await upsertAssessment({
      sessionId,
      slideId,
      userId: rating.studentId,
      label: rating.label,
      reason: rating.reason,
    });
  }

  emitRealtime("lesson:update", { sessionId, lessonId: lessonSession.lessonId, source: "lesson-assessment" });
  return NextResponse.json({
    ok: true,
    updated: finalRatings.length,
    assessments: finalRatings.map((rating) => ({
      key: `${rating.studentId}:${slideId}`,
      label: rating.label,
      reason: rating.reason,
    })),
  });
}
