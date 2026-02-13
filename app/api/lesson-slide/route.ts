import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { access, mkdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";

const buildSlideFilenames = (index: number, digits: number) => {
  const names = new Set<string>();
  names.add(`${index}.png`);
  names.add(`${String(index).padStart(digits, "0")}.png`);
  return Array.from(names);
};

export async function GET(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const slideId = searchParams.get("slideId");
  if (!slideId) return new Response("Missing slideId", { status: 400 });

  const slide = await prisma.lessonSlide.findUnique({ where: { id: slideId } });
  if (!slide) return new Response("Slide not found", { status: 404 });

  return Response.json({
    id: slide.id,
    index: slide.index,
    text: slide.text || "",
    prompt: slide.prompt || "",
    rubric: slide.rubric ? JSON.parse(slide.rubric) : [],
    responseType: slide.responseType || "text",
    responseConfig: slide.responseConfig ? JSON.parse(slide.responseConfig) : {},
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const lessonId = body?.lessonId as string | undefined;
  if (!lessonId) return new Response("Missing lessonId", { status: 400 });

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return new Response("Lesson not found", { status: 404 });

  const lastSlide = await prisma.lessonSlide.findFirst({
    where: { lessonId },
    orderBy: { index: "desc" },
  });
  const nextIndex = (lastSlide?.index || 0) + 1;

  const slide = await prisma.lessonSlide.create({
    data: {
      lessonId,
      index: nextIndex,
      text: "",
      responseConfig: JSON.stringify({ scratch: true }),
    },
  });

  if (nextIndex > lesson.pageCount) {
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { pageCount: nextIndex },
    });
  }

  const slidesDir = path.join(process.cwd(), "public", "uploads", "lessons", lessonId, "slides");
  await mkdir(slidesDir, { recursive: true });
  const { createCanvas, loadImage } = await import("canvas");
  let width = 1280;
  let height = 720;
  const digits = String(Math.max(lesson.pageCount, 1)).length;
  const refCandidates = [
    path.join(slidesDir, `${String(1).padStart(digits, "0")}.png`),
    path.join(slidesDir, "1.png"),
  ];
  for (const candidate of refCandidates) {
    try {
      await access(candidate);
      const img = await loadImage(candidate);
      if (img.width && img.height) {
        width = img.width;
        height = img.height;
        break;
      }
    } catch {
      // ignore missing reference slide
    }
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const buffer = canvas.toBuffer("image/png");
  const nextDigits = String(Math.max(lesson.pageCount, nextIndex, 1)).length;
  const outputFilenames = buildSlideFilenames(nextIndex, nextDigits);
  await Promise.all(outputFilenames.map((filename) => writeFile(path.join(slidesDir, filename), buffer)));

  return Response.json({ id: slide.id, index: slide.index });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const slideId = body?.slideId as string | undefined;
  if (!slideId) return new Response("Missing slideId", { status: 400 });

  const prompt = typeof body?.prompt === "string" ? body.prompt : undefined;
  const rubric = Array.isArray(body?.rubric) ? body.rubric : undefined;
  const responseType = typeof body?.responseType === "string" ? body.responseType : undefined;
  const responseConfig = body?.responseConfig && typeof body.responseConfig === "object"
    ? body.responseConfig
    : undefined;
  const sceneData = body?.sceneData && typeof body.sceneData === "object"
    ? body.sceneData
    : undefined;
  const text = typeof body?.text === "string" ? body.text : undefined;
  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : undefined;
  const existingSlide = await prisma.lessonSlide.findUnique({
    where: { id: slideId },
    select: { id: true, lessonId: true, index: true, responseConfig: true },
  });
  if (!existingSlide) {
    return new Response("Slide not found", { status: 404 });
  }

  if (imageDataUrl) {
    const slidesDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      "lessons",
      existingSlide.lessonId,
      "slides"
    );
    await mkdir(slidesDir, { recursive: true });
    const base64 = imageDataUrl.split(",")[1] || "";
    const buffer = Buffer.from(base64, "base64");
    const lesson = await prisma.lesson.findUnique({
      where: { id: existingSlide.lessonId },
      select: { pageCount: true },
    });
    const digits = String(Math.max(lesson?.pageCount || 1, existingSlide.index, 1)).length;
    const outputFilenames = buildSlideFilenames(existingSlide.index, digits);
    await Promise.all(outputFilenames.map((filename) => writeFile(path.join(slidesDir, filename), buffer)));
  }

  try {
    let mergedResponseConfig: Record<string, unknown> | undefined;
    if (responseConfig || sceneData) {
      const baseConfig =
        existingSlide.responseConfig && existingSlide.responseConfig.trim().length
          ? (JSON.parse(existingSlide.responseConfig) as Record<string, unknown>)
          : {};
      mergedResponseConfig = { ...baseConfig, ...(responseConfig || {}) };
      if (sceneData) {
        mergedResponseConfig.sceneData = sceneData;
      }
    }

    await prisma.lessonSlide.update({
      where: { id: slideId },
      data: {
        prompt,
        rubric: rubric ? JSON.stringify(rubric) : undefined,
        responseType,
        responseConfig: mergedResponseConfig ? JSON.stringify(mergedResponseConfig) : undefined,
        text,
      },
    });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: string }).code
      : undefined;
    if (code === "P2025") {
      return new Response("Slide not found", { status: 404 });
    }
    throw err;
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
  const slideId = body?.slideId as string | undefined;
  if (!slideId) return new Response("Missing slideId", { status: 400 });

  const slide = await prisma.lessonSlide.findUnique({ where: { id: slideId } });
  if (!slide) return new Response("Slide not found", { status: 404 });

  const lesson = await prisma.lesson.findUnique({ where: { id: slide.lessonId } });
  if (!lesson) return new Response("Lesson not found", { status: 404 });

  const deletedIndex = slide.index;
  await prisma.lessonSlide.delete({ where: { id: slideId } });
  await prisma.lessonSlide.updateMany({
    where: { lessonId: lesson.id, index: { gt: deletedIndex } },
    data: { index: { decrement: 1 } },
  });

  const slidesDir = path.join(process.cwd(), "public", "uploads", "lessons", lesson.id, "slides");
  const digits = String(Math.max(lesson.pageCount, 1)).length;
  const renameIfExists = async (from: string, to: string) => {
    try {
      await access(from);
      await rename(from, to);
    } catch {
      // ignore missing files
    }
  };
  const deleteIfExists = async (target: string) => {
    try {
      await access(target);
      await unlink(target);
    } catch {
      // ignore missing files
    }
  };

  await deleteIfExists(path.join(slidesDir, `${deletedIndex}.png`));
  await deleteIfExists(path.join(slidesDir, `${String(deletedIndex).padStart(digits, "0")}.png`));

  const maxIndex = await prisma.lessonSlide.findFirst({
    where: { lessonId: lesson.id },
    orderBy: { index: "desc" },
  });
  const newMax = maxIndex?.index || 0;

  for (let idx = deletedIndex + 1; idx <= lesson.pageCount; idx += 1) {
    const fromPlain = path.join(slidesDir, `${idx}.png`);
    const toPlain = path.join(slidesDir, `${idx - 1}.png`);
    await renameIfExists(fromPlain, toPlain);

    const fromPadded = path.join(slidesDir, `${String(idx).padStart(digits, "0")}.png`);
    const toPadded = path.join(slidesDir, `${String(idx - 1).padStart(digits, "0")}.png`);
    await renameIfExists(fromPadded, toPadded);
  }

  if (newMax !== lesson.pageCount) {
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { pageCount: newMax },
    });
  }

  return new Response("OK");
}
