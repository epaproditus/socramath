import { auth } from "@/auth";
import prisma from "@/lib/prisma";


export async function GET(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  const { searchParams } = new URL(req.url);
  const slideId = searchParams.get("slideId");
  const sessionId = searchParams.get("sessionId");
  const me = searchParams.get("me") === "1";
  if (!slideId || !sessionId) {
    return new Response("Missing slideId or sessionId", { status: 400 });
  }

  if (me) {
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    const response = await prisma.lessonResponse.findUnique({
      where: {
        sessionId_slideId_userId: {
          sessionId,
          slideId,
          userId: session.user.id,
        },
      },
    });
    return Response.json({
      response: response?.response || "",
      drawingPath: response?.drawingPath || "",
      responseType: response?.responseType || "text",
    });
  }

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const responses = await prisma.lessonResponse.findMany({
    where: { slideId, sessionId },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
  });

  return Response.json(
    responses.map((r) => ({
      id: r.id,
      response: r.response,
      responseType: r.responseType,
      drawingPath: r.drawingPath,
      user: {
        id: r.userId,
        name: r.user?.name,
        email: r.user?.email,
        classPeriod: r.user?.classPeriod,
      },
      updatedAt: r.updatedAt,
    }))
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const slideId = body?.slideId as string | undefined;
  const responseText = body?.response as string | undefined;
  const responseType = body?.responseType as string | undefined;

  if (!sessionId || !slideId || typeof responseText !== "string") {
    return new Response("Missing sessionId, slideId, or response", { status: 400 });
  }

  await prisma.lessonResponse.upsert({
    where: {
      sessionId_slideId_userId: {
        sessionId,
        slideId,
        userId: session.user.id,
      },
    },
    update: { response: responseText },
    create: {
      sessionId,
      slideId,
      userId: session.user.id,
      response: responseText,
      responseType: responseType || "text",
    },
  });

  return new Response("OK");
}
