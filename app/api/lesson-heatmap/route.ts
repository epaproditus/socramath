import { auth } from "@/auth";
import { normalizeLessonResponseConfig } from "@/lib/lesson-blocks";
import {
  computeLessonSlideCompletion,
  parseLessonResponseJson,
} from "@/lib/lesson-response";
import prisma from "@/lib/prisma";

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

type AssessmentRow = {
  sessionId: string;
  slideId: string;
  userId: string;
  label: string;
  reason: string | null;
  updatedAt: string | number | Date;
};

export async function GET() {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const lesson = await prisma.lesson.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!lesson) {
    return new Response("No active lesson", { status: 404 });
  }

  const lessonSession = await prisma.lessonSession.findFirst({
    where: { lessonId: lesson.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!lessonSession) {
    return new Response("No active lesson session", { status: 404 });
  }

  const slideRows = await prisma.lessonSlide.findMany({
    where: { lessonId: lesson.id },
    orderBy: { index: "asc" },
    select: {
      id: true,
      index: true,
      responseConfig: true,
      responseType: true,
      prompt: true,
    },
  });
  const slides = slideRows.map((slide) => ({ id: slide.id, index: slide.index }));
  const slideConfigById = new Map(
    slideRows.map((slide) => [
      slide.id,
      normalizeLessonResponseConfig(
        slide.responseConfig ? JSON.parse(slide.responseConfig) : {},
        {
          responseType: slide.responseType || "text",
          prompt: slide.prompt || "",
        }
      ),
    ])
  );

  await ensureAssessmentTable();
  const [responses, states, studentSlideStates, assessments] = await Promise.all([
    prisma.lessonResponse.findMany({
      where: { sessionId: lessonSession.id },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.lessonSessionState.findMany({
      where: { sessionId: lessonSession.id },
      include: { user: true },
    }),
    prisma.lessonStudentSlideState
      .findMany({
        where: { sessionId: lessonSession.id },
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      })
      .catch((err) => {
        if (isMissingTableError(err)) return [];
        throw err;
      }),
    prisma.$queryRawUnsafe<AssessmentRow[]>(
      `SELECT "sessionId","slideId","userId","label","reason","updatedAt"
       FROM "LessonCellAssessment"
       WHERE "sessionId" = ?`,
      lessonSession.id
    ),
  ]);

  const studentsMap = new Map<
    string,
    { id: string; name: string; email?: string | null; classPeriod?: string | null }
  >();
  for (const response of responses) {
    const name = response.user?.name || response.user?.email || "Student";
    studentsMap.set(response.userId, {
      id: response.userId,
      name,
      email: response.user?.email,
      classPeriod: response.user?.classPeriod || null,
    });
  }
  for (const state of states) {
    const name = state.user?.name || state.user?.email || "Student";
    studentsMap.set(state.userId, {
      id: state.userId,
      name,
      email: state.user?.email,
      classPeriod: state.user?.classPeriod || null,
    });
  }
  for (const studentState of studentSlideStates) {
    const name = studentState.user?.name || studentState.user?.email || "Student";
    studentsMap.set(studentState.userId, {
      id: studentState.userId,
      name,
      email: studentState.user?.email,
      classPeriod: studentState.user?.classPeriod || null,
    });
  }

  const students = Array.from(studentsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const cellMap = new Map<string, {
    response: string;
    responseJson: ReturnType<typeof parseLessonResponseJson>;
    drawingPath: string;
    drawingText: string;
    drawingSnapshot: string | null;
    updatedAt: string;
  }>();
  for (const response of responses) {
    cellMap.set(`${response.userId}:${response.slideId}`, {
      response: response.response || "",
      responseJson: parseLessonResponseJson(response.responseJson),
      drawingPath: response.drawingPath || "",
      drawingText: "",
      drawingSnapshot: null,
      updatedAt: response.updatedAt.toISOString(),
    });
  }
  for (const studentState of studentSlideStates) {
    const key = `${studentState.userId}:${studentState.slideId}`;
    const existing = cellMap.get(key);
    if (existing && new Date(existing.updatedAt).getTime() > studentState.updatedAt.getTime()) {
      continue;
    }
    const snapshotValue = studentState.drawingSnapshot;
    let snapshot: string | null = null;
    if (typeof snapshotValue === "string" && snapshotValue.trim()) {
      snapshot = snapshotValue;
    }
    cellMap.set(key, {
      response: studentState.responseText || existing?.response || "",
      responseJson:
        parseLessonResponseJson(studentState.responseJson) ||
        existing?.responseJson ||
        null,
      drawingPath: studentState.drawingPath || existing?.drawingPath || "",
      drawingText: studentState.drawingText || "",
      drawingSnapshot: snapshot ?? existing?.drawingSnapshot ?? null,
      updatedAt: studentState.updatedAt.toISOString(),
    });
  }

  return Response.json({
    lesson: {
      id: lesson.id,
      title: lesson.title,
      pageCount: lesson.pageCount,
    },
    session: {
      id: lessonSession.id,
      mode: lessonSession.mode,
      currentSlideIndex: lessonSession.currentSlideIndex,
      isFrozen: lessonSession.isFrozen,
      paceConfig: lessonSession.paceConfig ? JSON.parse(lessonSession.paceConfig) : null,
      timerEndsAt: lessonSession.timerEndsAt,
      timerRemainingSec: lessonSession.timerRemainingSec,
      timerRunning: lessonSession.timerRunning,
    },
    slides,
    students,
    states: states.map((state) => ({
      userId: state.userId,
      currentSlideIndex: state.currentSlideIndex,
      updatedAt: state.updatedAt.toISOString(),
    })),
    responses: Array.from(cellMap.entries()).map(([key, value]) => ({
      ...(function () {
        const [userId, slideId] = key.split(":");
        const completion = computeLessonSlideCompletion({
          blocks: slideConfigById.get(slideId)?.blocks || [],
          responseJson: value.responseJson || null,
          drawingPath: value.drawingPath,
          drawingText: value.drawingText,
        });
        return {
          key,
          userId,
          slideId,
          response: value.response,
          responseJson: value.responseJson,
          drawingPath: value.drawingPath,
          drawingText: value.drawingText,
          drawingSnapshot: value.drawingSnapshot,
          updatedAt: value.updatedAt,
          completion,
        };
      })(),
    })),
    assessments: assessments.map((assessment) => ({
      key: `${assessment.userId}:${assessment.slideId}`,
      label: assessment.label,
      reason: assessment.reason || "",
      updatedAt: String(assessment.updatedAt || ""),
    })),
  });
}
