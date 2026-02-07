import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
      currentSlideIndex: lessonSession.currentSlideIndex,
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

  const body = await req.json();
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

  return new Response("OK");
}
