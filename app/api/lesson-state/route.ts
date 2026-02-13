import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";

const isMissingTableError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "P2021";
const isReadonlyError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "message" in err &&
  String((err as { message?: unknown }).message || "").toLowerCase().includes("readonly");

type AssessmentRow = {
  label: string;
  reason: string | null;
  updatedAt: string | number | Date;
};

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

const toIsoString = (value: string | number | Date | null | undefined) => {
  if (value === null || value === undefined) return "";
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};


export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    return new Response("Admin email not configured", { status: 400 });
  }

  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    return new Response("Admin user not found", { status: 400 });
  }

  const lesson = await prisma.lesson.findFirst({
    where: { userId: adminUser.id, isActive: true },
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

  let currentSlideIndex = lessonSession.currentSlideIndex;
  let isFrozen = lessonSession.isFrozen;
  let paceConfig: { allowedSlides?: number[] } | null = null;
  if (lessonSession.paceConfig) {
    try {
      paceConfig = JSON.parse(lessonSession.paceConfig);
    } catch {
      paceConfig = null;
    }
  }
  let timerRunning = lessonSession.timerRunning;
  let timerEndsAt = lessonSession.timerEndsAt;
  let timerRemainingSec = lessonSession.timerRemainingSec;
  if (timerRunning && timerEndsAt && timerEndsAt.getTime() <= Date.now()) {
    timerRunning = false;
    timerEndsAt = null;
    timerRemainingSec = 0;
    isFrozen = true;
    await prisma.lessonSession
      .update({
        where: { id: lessonSession.id },
        data: {
          timerRunning: false,
          timerEndsAt: null,
          timerRemainingSec: 0,
          isFrozen: true,
        },
      })
      .catch(() => {});
  }
  if (lessonSession.mode === "student") {
    const state = await prisma.lessonSessionState.upsert({
      where: {
        sessionId_userId: {
          sessionId: lessonSession.id,
          userId: session.user.id,
        },
      },
      update: {},
      create: {
        sessionId: lessonSession.id,
        userId: session.user.id,
        currentSlideIndex: 1,
      },
    });
    currentSlideIndex = state.currentSlideIndex;
  }

  const slides = await prisma.lessonSlide.findMany({
    where: { lessonId: lesson.id },
    orderBy: { index: "asc" },
    select: { id: true, index: true },
  });
  const maxSlideIndex = slides[slides.length - 1]?.index || 1;
  const allowedSlides = Array.isArray(paceConfig?.allowedSlides)
    ? paceConfig?.allowedSlides?.filter((idx) => typeof idx === "number")
    : null;
  if (allowedSlides && allowedSlides.length) {
    const sorted = Array.from(new Set(allowedSlides)).sort((a, b) => a - b);
    if (!sorted.includes(currentSlideIndex)) {
      currentSlideIndex = sorted[0] || 1;
      if (lessonSession.mode === "student") {
        await prisma.lessonSessionState.update({
          where: {
            sessionId_userId: {
              sessionId: lessonSession.id,
              userId: session.user.id,
            },
          },
          data: { currentSlideIndex },
        }).catch(() => {});
      } else {
        await prisma.lessonSession.update({
          where: { id: lessonSession.id },
          data: { currentSlideIndex },
        }).catch(() => {});
      }
    }
  }

  if (currentSlideIndex > maxSlideIndex) {
    currentSlideIndex = maxSlideIndex;
    if (lessonSession.mode === "student") {
      await prisma.lessonSessionState.update({
        where: {
          sessionId_userId: {
            sessionId: lessonSession.id,
            userId: session.user.id,
          },
        },
        data: { currentSlideIndex },
      }).catch(() => {});
    } else {
      await prisma.lessonSession.update({
        where: { id: lessonSession.id },
        data: { currentSlideIndex },
      }).catch(() => {});
    }
  }
  const slide = await prisma.lessonSlide.findFirst({
    where: { lessonId: lesson.id, index: currentSlideIndex },
  });
  await ensureAssessmentTable().catch((err) => {
    if (!isReadonlyError(err)) throw err;
  });
  const slideWork =
    slide?.id
      ? await prisma.lessonStudentSlideState
          .findUnique({
            where: {
              sessionId_slideId_userId: {
                sessionId: lessonSession.id,
                slideId: slide.id,
                userId: session.user.id,
              },
            },
          })
          .catch((err) => {
            if (isMissingTableError(err)) return null;
            throw err;
          })
      : null;
  const slideAssessment =
    slide?.id
      ? await prisma
          .$queryRawUnsafe<AssessmentRow[]>(
            `SELECT "label","reason","updatedAt"
             FROM "LessonCellAssessment"
             WHERE "sessionId" = ? AND "slideId" = ? AND "userId" = ?
             LIMIT 1`,
            lessonSession.id,
            slide.id,
            session.user.id
          )
          .then((rows) => rows[0] || null)
          .catch((err) => {
            if (isMissingTableError(err)) return null;
            throw err;
          })
      : null;
  let drawingSnapshot: Record<string, unknown> | null = null;
  if (slideWork?.drawingSnapshot) {
    try {
      drawingSnapshot = JSON.parse(slideWork.drawingSnapshot);
    } catch {
      drawingSnapshot = null;
    }
  }

  return Response.json({
    lesson: {
      id: lesson.id,
      title: lesson.title,
      pdfPath: lesson.pdfPath,
      pageCount: lesson.pageCount,
      content: lesson.content,
    },
    session: {
      id: lessonSession.id,
      mode: lessonSession.mode,
      currentSlideIndex,
      isFrozen,
      paceConfig,
      timerEndsAt,
      timerRemainingSec,
      timerRunning,
    },
    currentSlideIndex,
    currentSlideId: slide?.id || null,
    slideText: slide?.text || "",
    slidePrompt: slide?.prompt || "",
    slideRubric: slide?.rubric ? JSON.parse(slide.rubric) : [],
    slideResponseType: slide?.responseType || "text",
    slideResponseConfig: slide?.responseConfig ? JSON.parse(slide.responseConfig) : {},
    slideAssessment: slideAssessment
      ? {
          label: slideAssessment.label,
          reason: slideAssessment.reason || "",
          updatedAt: toIsoString(slideAssessment.updatedAt),
        }
      : null,
    slideWork: slideWork
      ? {
          responseText: slideWork.responseText || "",
          drawingPath: slideWork.drawingPath || "",
          drawingText: slideWork.drawingText || "",
          drawingSnapshot,
          updatedAt: slideWork.updatedAt,
        }
      : null,
    slides,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const sessionId = body?.sessionId as string | undefined;
  const currentSlideIndex = body?.currentSlideIndex as number | undefined;
  if (!sessionId || typeof currentSlideIndex !== "number") {
    return new Response("Missing sessionId or currentSlideIndex", { status: 400 });
  }

  const lessonSession = await prisma.lessonSession.findUnique({
    where: { id: sessionId },
  });
  if (!lessonSession) {
    return new Response("Lesson session not found", { status: 404 });
  }

  if (lessonSession.mode !== "student") {
    return new Response("Session is instructor-paced", { status: 400 });
  }
  if (lessonSession.isFrozen) {
    return new Response("Session is frozen", { status: 423 });
  }

  let paceConfig: { allowedSlides?: number[] } | null = null;
  if (lessonSession.paceConfig) {
    try {
      paceConfig = JSON.parse(lessonSession.paceConfig);
    } catch {
      paceConfig = null;
    }
  }
  const allowedSlides = Array.isArray(paceConfig?.allowedSlides)
    ? paceConfig?.allowedSlides?.filter((idx) => typeof idx === "number")
    : null;
  if (allowedSlides && allowedSlides.length && !allowedSlides.includes(currentSlideIndex)) {
    return new Response("Slide not allowed", { status: 403 });
  }

  try {
    await prisma.lessonSessionState.upsert({
      where: {
        sessionId_userId: {
          sessionId,
          userId: session.user.id,
        },
      },
      update: {
        currentSlideIndex: Math.max(1, currentSlideIndex),
      },
      create: {
        sessionId,
        userId: session.user.id,
        currentSlideIndex: Math.max(1, currentSlideIndex),
      },
    });
  } catch (err) {
    const message =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message || "")
        : "";
    if (!message.toLowerCase().includes("readonly")) {
      throw err;
    }
    console.warn("lesson-state upsert skipped (readonly db)");
  }

  emitRealtime("lesson:update", { sessionId, lessonId: lessonSession.lessonId, source: "lesson-state" });
  return new Response("OK");
}
