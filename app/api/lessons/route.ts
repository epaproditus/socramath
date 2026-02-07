import { auth } from "@/auth";
import prisma from "@/lib/prisma";


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

  const lessons = await prisma.lesson.findMany({
    where: { userId: adminUser.id },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(
    lessons.map((l) => ({
      id: l.id,
      title: l.title,
      isActive: l.isActive,
      createdAt: l.createdAt,
      sourceFilename: l.sourceFilename,
      pdfPath: l.pdfPath,
      pageCount: l.pageCount,
    }))
  );
}

export async function PATCH(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const lessonId = body?.id;
  if (!lessonId || typeof lessonId !== "string") {
    return new Response("Missing lesson id", { status: 400 });
  }

  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    return new Response("Admin user not found. Log in once as admin.", { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.lesson.updateMany({
      where: { userId: adminUser.id, isActive: true },
      data: { isActive: false },
    });
    return tx.lesson.updateMany({
      where: { id: lessonId, userId: adminUser.id },
      data: { isActive: true },
    });
  });

  if (!result.count) {
    return new Response("Lesson not found", { status: 404 });
  }

  return new Response("OK");
}

export async function DELETE(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const lessonId = body?.id;
  if (!lessonId || typeof lessonId !== "string") {
    return new Response("Missing lesson id", { status: 400 });
  }

  await prisma.lesson.delete({ where: { id: lessonId } });

  try {
    const { rm } = await import("fs/promises");
    const { join } = await import("path");
    const dir = join(process.cwd(), "public", "uploads", "lessons", lessonId);
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore filesystem cleanup errors
  }

  return new Response("OK");
}
