import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

  await prisma.lessonSlide.update({
    where: { id: slideId },
    data: {
      prompt,
      rubric: rubric ? JSON.stringify(rubric) : undefined,
      responseType,
      responseConfig: responseConfig ? JSON.stringify(responseConfig) : undefined,
    },
  });

  return new Response("OK");
}
