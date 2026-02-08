import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { access, mkdir, writeFile } from "fs/promises";
import path from "path";


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
  await writeFile(path.join(slidesDir, `${nextIndex}.png`), buffer);

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
  const text = typeof body?.text === "string" ? body.text : undefined;
  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : undefined;

  if (imageDataUrl) {
    const slide = await prisma.lessonSlide.findUnique({ where: { id: slideId } });
    if (slide) {
      const lesson = await prisma.lesson.findUnique({ where: { id: slide.lessonId } });
      if (lesson) {
        const slidesDir = path.join(process.cwd(), "public", "uploads", "lessons", lesson.id, "slides");
        await mkdir(slidesDir, { recursive: true });
        const base64 = imageDataUrl.split(",")[1] || "";
        const buffer = Buffer.from(base64, "base64");
        await writeFile(path.join(slidesDir, `${slide.index}.png`), buffer);
      }
    }
  }

  await prisma.lessonSlide.update({
    where: { id: slideId },
    data: {
      prompt,
      rubric: rubric ? JSON.stringify(rubric) : undefined,
      responseType,
      responseConfig: responseConfig ? JSON.stringify(responseConfig) : undefined,
      text,
    },
  });

  return new Response("OK");
}
