import { auth } from "@/auth";
import prisma from "@/lib/prisma";

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

  const slides = await prisma.lessonSlide.findMany({
    where: { lessonId: lesson.id },
    orderBy: { index: "asc" },
    select: { id: true, index: true },
  });

  const responses = await prisma.lessonResponse.findMany({
    where: { sessionId: lessonSession.id },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
  });

  const studentsMap = new Map<string, { id: string; name: string; email?: string | null }>();
  for (const response of responses) {
    const name = response.user?.name || response.user?.email || "Student";
    studentsMap.set(response.userId, {
      id: response.userId,
      name,
      email: response.user?.email,
    });
  }

  const students = Array.from(studentsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const cellMap = new Map<string, {
    response: string;
    drawingPath: string;
    updatedAt: string;
  }>();
  for (const response of responses) {
    cellMap.set(`${response.userId}:${response.slideId}`, {
      response: response.response || "",
      drawingPath: response.drawingPath || "",
      updatedAt: response.updatedAt.toISOString(),
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
    },
    slides,
    students,
    responses: Array.from(cellMap.entries()).map(([key, value]) => ({
      key,
      ...value,
    })),
  });
}
