import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";

type AssessmentLabel = "green" | "yellow" | "red" | "grey";

type StudentContext = {
  userId: string;
  name: string;
  currentResponseText: string;
  currentDrawingText: string;
  currentDrawingPath: string;
  otherTypedSummary: string;
  otherDrawingSummary: string;
  updatedAt: Date;
};

type Rating = {
  studentId: string;
  label: AssessmentLabel;
  reason: string;
};
type AssessmentSource = "teacher" | "student";
type PromptPart = {
  id: string;
  raw: string;
  tokens: string[];
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

const parseResponseConfigSummary = (raw: string | null) => {
  if (!raw) return "None";
  try {
    const parsed = JSON.parse(raw) as {
      widgets?: unknown;
      choices?: unknown;
      multi?: unknown;
      explain?: unknown;
    };
    const widgets = Array.isArray(parsed.widgets)
      ? parsed.widgets.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const choices = Array.isArray(parsed.choices)
      ? parsed.choices.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const parts: string[] = [];
    if (widgets.length) parts.push(`widgets=${widgets.join(",")}`);
    if (choices.length) parts.push(`choices=${choices.length}`);
    if (parsed.multi === true) parts.push("multi=true");
    if (parsed.explain === true) parts.push("explain=true");
    if (!parts.length) return "None";
    return parts.join(" | ").slice(0, 500);
  } catch {
    return trimText(raw, 500);
  }
};

const stopwords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "then",
  "when",
  "where",
  "which",
  "what",
  "your",
  "their",
  "have",
  "into",
  "after",
  "before",
  "about",
  "loan",
  "rate",
  "time",
  "years",
  "year",
  "find",
  "calculate",
  "determine",
  "answer",
  "problem",
  "slide",
  "show",
  "work",
  "made",
  "made",
]);

const normalizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.%$\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeForPart = (value: string) =>
  normalizeForMatch(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => {
      if (!token) return false;
      if (/\d/.test(token)) return token.length >= 2;
      if (token.length < 4) return false;
      return !stopwords.has(token);
    })
    .slice(0, 24);

const extractPromptParts = (prompt: string, text: string): PromptPart[] => {
  const source = [prompt, text].filter(Boolean).join("\n");
  if (!source.trim()) return [];
  const normalized = source.replace(/\r/g, " ").replace(/\n/g, " ");
  const parts: PromptPart[] = [];
  const re = /(^|\s)(\d{1,2})\.\s+(.+?)(?=(?:\s\d{1,2}\.\s+)|$)/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(normalized)) !== null) {
    const id = String(match[2] || "").trim();
    const raw = String(match[3] || "").trim();
    if (!id || !raw) continue;
    const tokens = tokenizeForPart(raw);
    parts.push({ id, raw, tokens });
  }
  return parts;
};

const evaluateCoverage = (
  evidenceText: string,
  parts: PromptPart[],
  rubricTokens: string[]
) => {
  if (!parts.length) {
    return { total: 0, addressed: 0, complete: true };
  }
  const evidence = normalizeForMatch(evidenceText);
  const rubricSet = Array.from(new Set(rubricTokens.filter(Boolean)));
  const rubricHits = rubricSet.filter((token) => evidence.includes(token)).length;
  let addressed = 0;
  for (const part of parts) {
    const numericTokens = part.tokens.filter((token) => /\d/.test(token));
    const lexicalTokens = Array.from(
      new Set(part.tokens.filter((token) => !/\d/.test(token)))
    );
    const numericHit =
      numericTokens.length > 0 &&
      numericTokens.some((token) => {
        const normalizedToken = token.replace(/[^\d.%]/g, "");
        return normalizedToken ? evidence.includes(normalizedToken) : false;
      });
    const lexicalHits = lexicalTokens.filter((token) => evidence.includes(token)).length;
    const rubricSupport =
      (lexicalHits >= 1 && rubricHits >= 1) || rubricHits >= 3;
    if (numericHit || lexicalHits >= 2 || rubricSupport) addressed += 1;
  }
  return {
    total: parts.length,
    addressed,
    complete: addressed >= parts.length,
  };
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
  source,
}: {
  sessionId: string;
  slideId: string;
  userId: string;
  label: AssessmentLabel;
  reason: string;
  source: AssessmentSource;
}) => {
  const now = Date.now();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "LessonCellAssessment"
      ("id","sessionId","slideId","userId","label","reason","source","createdAt","updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("sessionId","slideId","userId")
      DO UPDATE SET
        "label"=excluded."label",
        "reason"=excluded."reason",
        "source"=excluded."source",
        "updatedAt"=excluded."updatedAt"
    `,
    crypto.randomUUID(),
    sessionId,
    slideId,
    userId,
    label,
    reason,
    source,
    now,
    now
  );
};

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const isAdmin =
    !!session.user.email && !!adminEmail && session.user.email === adminEmail;

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const slideId = body?.slideId as string | undefined;
  const requestedStudentId = body?.studentId as string | undefined;
  const requestedLabel = body?.label as AssessmentLabel | undefined;
  const requestedReason = body?.reason as string | undefined;
  const studentId = isAdmin ? requestedStudentId : session.user.id;
  if (!sessionId || !slideId) {
    return new NextResponse("Missing sessionId or slideId", { status: 400 });
  }
  if (!isAdmin && requestedStudentId && requestedStudentId !== session.user.id) {
    return new NextResponse("Forbidden", { status: 403 });
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

  if (requestedLabel) {
    await ensureAssessmentTable();
    await upsertAssessment({
      sessionId,
      slideId,
      userId: studentId || session.user.id,
      label: sanitizeLabel(requestedLabel),
      reason: trimText(
        typeof requestedReason === "string" && requestedReason.trim()
          ? requestedReason.trim()
          : "Manual override.",
        200
      ),
      source: isAdmin ? "teacher" : "student",
    });
    emitRealtime("lesson:update", {
      sessionId,
      lessonId: lessonSession.lessonId,
      source: "lesson-assessment",
    });
    return NextResponse.json({
      ok: true,
      updated: 1,
      assessments: [
        {
          key: `${studentId || session.user.id}:${slideId}`,
          label: sanitizeLabel(requestedLabel),
          reason:
            typeof requestedReason === "string" && requestedReason.trim()
              ? requestedReason.trim().slice(0, 200)
              : "Manual override.",
        },
      ],
    });
  }
  const promptParts = extractPromptParts(slide.prompt || "", slide.text || "");
  const rubricText = parseRubric(slide.rubric || null);
  const rubricTokens = rubricText === "None" ? [] : tokenizeForPart(rubricText);

  const [lessonSlides, responses, studentStates, sessionStates] = await Promise.all([
    prisma.lessonSlide.findMany({
      where: { lessonId: lessonSession.lessonId },
      select: { id: true, index: true },
      orderBy: { index: "asc" },
    }),
    prisma.lessonResponse.findMany({
      where: {
        sessionId,
        ...(studentId ? { userId: studentId } : {}),
      },
      include: { user: true, slide: { select: { id: true, index: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.lessonStudentSlideState
      .findMany({
        where: {
          sessionId,
          ...(studentId ? { userId: studentId } : {}),
        },
        include: { user: true, slide: { select: { id: true, index: true } } },
        orderBy: { updatedAt: "desc" },
      })
      .catch((err) => {
        if (isMissingTableError(err)) return [];
        throw err;
      }),
    prisma.lessonSessionState.findMany({
      where: {
        sessionId,
        ...(studentId ? { userId: studentId } : {}),
      },
      include: { user: true },
    }),
  ]);

  type WorkCell = {
    userId: string;
    slideId: string;
    slideIndex: number;
    name: string;
    responseText: string;
    drawingText: string;
    drawingPath: string;
    updatedAt: Date;
  };
  const slideIndexMap = new Map(lessonSlides.map((item) => [item.id, item.index]));
  const workByUserSlide = new Map<string, WorkCell>();
  const rosterByUser = new Map<string, { userId: string; name: string }>();

  for (const response of responses) {
    const userName = response.user?.name || response.user?.email || "Student";
    rosterByUser.set(response.userId, { userId: response.userId, name: userName });
    const key = `${response.userId}:${response.slideId}`;
    workByUserSlide.set(key, {
      userId: response.userId,
      slideId: response.slideId,
      slideIndex: response.slide?.index || slideIndexMap.get(response.slideId) || 0,
      name: userName,
      responseText: response.response || "",
      drawingText: "",
      drawingPath: response.drawingPath || "",
      updatedAt: response.updatedAt,
    });
  }

  for (const state of studentStates) {
    const userName = state.user?.name || state.user?.email || "Student";
    rosterByUser.set(state.userId, { userId: state.userId, name: userName });
    const key = `${state.userId}:${state.slideId}`;
    const existing = workByUserSlide.get(key);
    if (existing && existing.updatedAt > state.updatedAt) continue;
    workByUserSlide.set(key, {
      userId: state.userId,
      slideId: state.slideId,
      slideIndex: state.slide?.index || slideIndexMap.get(state.slideId) || existing?.slideIndex || 0,
      name: userName || existing?.name || "Student",
      responseText: state.responseText || existing?.responseText || "",
      drawingText: state.drawingText || "",
      drawingPath: state.drawingPath || existing?.drawingPath || "",
      updatedAt: state.updatedAt,
    });
  }

  for (const state of sessionStates) {
    const userName = state.user?.name || state.user?.email || "Student";
    rosterByUser.set(state.userId, { userId: state.userId, name: userName });
  }

  if (!rosterByUser.size && !studentId) {
    return NextResponse.json({ ok: true, updated: 0, assessments: [] });
  }
  if (studentId && !rosterByUser.has(studentId)) {
    const user = await prisma.user.findUnique({
      where: { id: studentId },
      select: { name: true, email: true },
    });
    rosterByUser.set(studentId, {
      userId: studentId,
      name: user?.name || user?.email || session.user.name || session.user.email || "Student",
    });
  }

  const workByUser = new Map<string, WorkCell[]>();
  for (const cell of workByUserSlide.values()) {
    const list = workByUser.get(cell.userId) || [];
    list.push(cell);
    workByUser.set(cell.userId, list);
  }

  const contexts: StudentContext[] = Array.from(rosterByUser.values()).map((student) => {
    const perSlide = [...(workByUser.get(student.userId) || [])].sort(
      (a, b) => a.slideIndex - b.slideIndex || b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    const current = perSlide.find((item) => item.slideId === slideId);
    const other = perSlide.filter((item) => item.slideId !== slideId);
    const otherTypedSummary = other
      .map((item) => {
        const typed = normalizeTypedResponse(item.responseText);
        if (!typed) return "";
        return `S${item.slideIndex}: ${trimText(typed, 140)}`;
      })
      .filter(Boolean)
      .slice(0, 6)
      .join(" || ");
    const otherDrawingSummary = other
      .map((item) => {
        const drawing = item.drawingText.trim();
        if (!drawing) return "";
        return `S${item.slideIndex}: ${trimText(drawing, 140)}`;
      })
      .filter(Boolean)
      .slice(0, 6)
      .join(" || ");

    return {
      userId: student.userId,
      name: student.name,
      currentResponseText: current?.responseText || "",
      currentDrawingText: current?.drawingText || "",
      currentDrawingPath: current?.drawingPath || "",
      otherTypedSummary: otherTypedSummary || "None",
      otherDrawingSummary: otherDrawingSummary || "None",
      updatedAt: current?.updatedAt || perSlide[0]?.updatedAt || new Date(0),
    };
  });

  await ensureAssessmentTable();

  const autoGrey: Rating[] = [];
  const evaluable = contexts
    .map((context) => {
      const typed = normalizeTypedResponse(context.currentResponseText);
      const drawing = context.currentDrawingText.trim();
      const evidence = [typed ? `typed: ${typed}` : "", drawing ? `drawing text: ${drawing}` : ""]
        .filter(Boolean)
        .join(" | ");
      const coverage = evaluateCoverage(evidence, promptParts, rubricTokens);
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
        otherTypedSummary: context.otherTypedSummary,
        otherDrawingSummary: context.otherDrawingSummary,
        coverage,
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
    const responseConfigSummary = parseResponseConfigSummary(slide.responseConfig || null);

    const system = `You evaluate student understanding for one slide.
Return strict JSON only:
{"ratings":[{"studentId":"string","label":"green|yellow|red","reason":"string","next_steps":"string"}]}
Rubric:
- green: evidence clearly addresses all required parts in the slide prompt and rubric.
- yellow: partial understanding or unclear/incomplete reasoning.
- red: likely misconception or incorrect understanding.
Rules:
- Score only this slide using "current slide evidence".
- Other-slide context is supplemental and MUST NOT by itself justify green.
- If current slide evidence is partial, incomplete, or covers only one part, do not return green.
- Never use names in reason.
- Keep reason under 20 words.
- next_steps should be a short, actionable fix for how to reach green (max 24 words).
- Do not output markdown.`;

    const userPrompt = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Slide index: ${slide.index}`,
      `Slide prompt: ${trimText(slide.prompt || "None", 600)}`,
      `Slide text: ${trimText(slide.text || "None", 600)}`,
      `Rubric: ${parseRubric(slide.rubric || null)}`,
      `Response type: ${slide.responseType || "text"}`,
      `Response config: ${responseConfigSummary}`,
      `Detected prompt parts: ${
        promptParts.length
          ? promptParts.map((part) => `${part.id}. ${trimText(part.raw, 120)}`).join(" || ")
          : "none"
      }`,
      "Evidence by student:",
      ...evaluable.map(
        (entry) =>
          [
            `- ${entry.studentId}:`,
            `  current slide evidence: ${trimText(entry.evidence, 500)}`,
            `  coverage estimate: addressed ${entry.coverage.addressed} of ${entry.coverage.total} prompt parts`,
            `  other slide typed responses: ${trimText(entry.otherTypedSummary, 450)}`,
            `  other slide drawing text: ${trimText(entry.otherDrawingSummary, 450)}`,
          ].join("\n")
      ),
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
      const row = item as { studentId?: unknown; label?: unknown; reason?: unknown; next_steps?: unknown };
      const sid = String(row.studentId || "").trim();
      if (!sid) continue;
      const reasonText = String(row.reason || "").trim();
      const nextSteps = String(row.next_steps || "").trim();
      const combinedReason = [reasonText, nextSteps ? `Next: ${nextSteps}` : ""]
        .filter(Boolean)
        .join(" ");
      ratingByStudent.set(sid, {
        studentId: sid,
        label: sanitizeLabel(row.label),
        reason: trimText(combinedReason || "Assessment generated.", 200),
      });
    }

    llmRatings = evaluable.map((entry) => {
      const found = ratingByStudent.get(entry.studentId);
      return (
        found || {
          studentId: entry.studentId,
          label: "yellow",
          reason: "Partial evidence; needs clearer reasoning.",
        }
      );
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
      source: isAdmin ? "teacher" : "student",
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
