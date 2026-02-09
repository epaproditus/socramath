import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";


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
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "";
    if (!message.toLowerCase().includes("readonly")) {
      throw err;
    }
    console.warn("lesson-state upsert skipped (readonly db)");
  }

  emitRealtime("lesson:update", { sessionId, lessonId: lessonSession.lessonId, source: "lesson-state" });
  return new Response("OK");
}
