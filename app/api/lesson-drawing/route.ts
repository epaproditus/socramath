import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const isMissingTableError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "P2021";

const isReadonlyError = (err: unknown) => {
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message || "")
      : "";
  return message.toLowerCase().includes("readonly");
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const sessionId = body?.sessionId as string | undefined;
  const slideId = body?.slideId as string | undefined;
  const dataUrl = body?.dataUrl as string | undefined;
  const drawingText = typeof body?.drawingText === "string" ? body.drawingText : undefined;
  const drawingSnapshotValue = body?.drawingSnapshot;
  const drawingSnapshot =
    drawingSnapshotValue === null
      ? null
      : drawingSnapshotValue && typeof drawingSnapshotValue === "object"
      ? JSON.stringify(drawingSnapshotValue)
      : undefined;

  if (!sessionId || !slideId || !dataUrl) {
    return new Response("Missing sessionId, slideId, or dataUrl", { status: 400 });
  }

  const lessonSession = await prisma.lessonSession.findUnique({ where: { id: sessionId } });
  if (!lessonSession) return new Response("Lesson session not found", { status: 404 });

  const slide = await prisma.lessonSlide.findUnique({ where: { id: slideId } });
  if (!slide) return new Response("Slide not found", { status: 404 });

  const matches = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!matches) return new Response("Invalid data URL", { status: 400 });
  const buffer = Buffer.from(matches[1], "base64");

  const baseDir = path.join(process.cwd(), "public", "uploads", "lessons", slide.lessonId, "responses", sessionId, slideId);
  await mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${session.user.id}.png`);
  await writeFile(filePath, buffer);

  const publicPath = `/uploads/lessons/${slide.lessonId}/responses/${sessionId}/${slideId}/${session.user.id}.png`;

  try {
    await prisma.lessonResponse.upsert({
      where: {
        sessionId_slideId_userId: {
          sessionId,
          slideId,
          userId: session.user.id,
        },
      },
      update: {
        drawingPath: publicPath,
        responseType: "drawing",
      },
      create: {
        sessionId,
        slideId,
        userId: session.user.id,
        response: "",
        drawingPath: publicPath,
        responseType: "drawing",
      },
    });
  } catch (err) {
    if (!isReadonlyError(err)) {
      throw err;
    }
    console.warn("lesson-drawing upsert skipped (readonly db)");
  }

  const stateUpdate: {
    drawingPath: string;
    drawingText?: string;
    drawingSnapshot?: string | null;
  } = {
    drawingPath: publicPath,
  };
  if (typeof drawingText === "string") stateUpdate.drawingText = drawingText;
  if (drawingSnapshot !== undefined) stateUpdate.drawingSnapshot = drawingSnapshot;

  const stateCreate: {
    sessionId: string;
    slideId: string;
    userId: string;
    responseText: string;
    drawingPath: string;
    drawingText?: string;
    drawingSnapshot?: string | null;
  } = {
    sessionId,
    slideId,
    userId: session.user.id,
    responseText: "",
    drawingPath: publicPath,
  };
  if (typeof drawingText === "string") stateCreate.drawingText = drawingText;
  if (drawingSnapshot !== undefined) stateCreate.drawingSnapshot = drawingSnapshot;

  try {
    await prisma.lessonStudentSlideState.upsert({
      where: {
        sessionId_slideId_userId: {
          sessionId,
          slideId,
          userId: session.user.id,
        },
      },
      update: stateUpdate,
      create: stateCreate,
    });
  } catch (err) {
    if (isMissingTableError(err) || isReadonlyError(err)) {
      if (isReadonlyError(err)) {
        console.warn("lesson-drawing state upsert skipped (readonly db)");
      }
    } else {
      throw err;
    }
  }

  emitRealtime("lesson:update", { sessionId, lessonId: slide.lessonId, source: "lesson-drawing" });
  return Response.json({ drawingPath: publicPath });
}
