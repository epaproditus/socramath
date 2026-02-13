import { auth } from "@/auth";
import { mergeLessonPaceConfig, parseLessonPaceConfig } from "@/lib/lesson-pace";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";

const readStoredPaceConfig = (raw: string | null) => {
  if (!raw) return null;
  try {
    return parseLessonPaceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
};


export async function GET() {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    return new Response("Admin user not found. Log in once as admin.", { status: 400 });
  }

  const lesson = await prisma.lesson.findFirst({
    where: { userId: adminUser.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!lesson) {
    return new Response("No active lesson", { status: 404 });
  }

  let sessionRow = await prisma.lessonSession.findFirst({
    where: { lessonId: lesson.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!sessionRow) {
    sessionRow = await prisma.lessonSession.create({
      data: {
        lessonId: lesson.id,
        mode: "instructor",
        currentSlideIndex: 1,
        isActive: true,
      },
    });
  }

  let slides = await prisma.lessonSlide.findMany({
    where: { lessonId: lesson.id },
    orderBy: { index: "asc" },
    select: { id: true, index: true },
  });
  if (!slides.length && lesson.pageCount) {
    await prisma.$transaction(
      Array.from({ length: lesson.pageCount }).map((_, idx) =>
        prisma.lessonSlide.create({
          data: {
            lessonId: lesson.id,
            index: idx + 1,
            text: "",
          },
        })
      )
    );
    slides = await prisma.lessonSlide.findMany({
      where: { lessonId: lesson.id },
      orderBy: { index: "asc" },
      select: { id: true, index: true },
    });
  }

  return Response.json({
    lesson: {
      id: lesson.id,
      title: lesson.title,
      pdfPath: lesson.pdfPath,
      pageCount: lesson.pageCount,
    },
    session: {
      id: sessionRow.id,
      mode: sessionRow.mode,
      currentSlideIndex: sessionRow.currentSlideIndex,
      isFrozen: sessionRow.isFrozen,
      paceConfig: readStoredPaceConfig(sessionRow.paceConfig),
      timerEndsAt: sessionRow.timerEndsAt,
      timerRemainingSec: sessionRow.timerRemainingSec,
      timerRunning: sessionRow.timerRunning,
    },
    slides,
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }

  const existingSession = await prisma.lessonSession.findUnique({
    where: { id: sessionId },
    select: { paceConfig: true },
  });
  if (!existingSession) {
    return new Response("Lesson session not found", { status: 404 });
  }

  const data: {
    mode?: "instructor" | "student";
    currentSlideIndex?: number;
    isFrozen?: boolean;
    timerRunning?: boolean;
    timerRemainingSec?: number;
    timerEndsAt?: Date | null;
    paceConfig?: string | null;
  } = {};
  if (body?.mode === "instructor" || body?.mode === "student") {
    data.mode = body.mode;
  }
  if (typeof body?.currentSlideIndex === "number") {
    data.currentSlideIndex = Math.max(1, body.currentSlideIndex);
  }
  if (typeof body?.isFrozen === "boolean") {
    data.isFrozen = body.isFrozen;
  }
  if (typeof body?.timerRunning === "boolean") {
    data.timerRunning = body.timerRunning;
  }
  if (typeof body?.timerRemainingSec === "number") {
    data.timerRemainingSec = body.timerRemainingSec;
  }
  if (typeof body?.timerEndsAt === "string" || body?.timerEndsAt === null) {
    data.timerEndsAt = body.timerEndsAt ? new Date(body.timerEndsAt) : null;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "paceConfig")) {
    let existingPaceConfig = null;
    existingPaceConfig = readStoredPaceConfig(existingSession.paceConfig);
    const mergedPaceConfig = mergeLessonPaceConfig(existingPaceConfig, body.paceConfig);
    data.paceConfig = mergedPaceConfig ? JSON.stringify(mergedPaceConfig) : null;
  }

  if (!Object.keys(data).length) {
    return new Response("No updates", { status: 400 });
  }

  await prisma.lessonSession.update({
    where: { id: sessionId },
    data,
  });

  emitRealtime("lesson:update", { sessionId, source: "lesson-session" });
  return new Response("OK");
}
