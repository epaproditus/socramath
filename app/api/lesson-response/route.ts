import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { emitRealtime } from "@/lib/realtime";

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

    const [response, studentState] = await Promise.all([
      prisma.lessonResponse.findUnique({
        where: {
          sessionId_slideId_userId: {
            sessionId,
            slideId,
            userId: session.user.id,
          },
        },
      }),
      prisma.lessonStudentSlideState
        .findUnique({
          where: {
            sessionId_slideId_userId: {
              sessionId,
              slideId,
              userId: session.user.id,
            },
          },
        })
        .catch((err) => {
          if (isMissingTableError(err)) return null;
          throw err;
        }),
    ]);

    let drawingSnapshot: Record<string, unknown> | null = null;
    if (studentState?.drawingSnapshot) {
      try {
        drawingSnapshot = JSON.parse(studentState.drawingSnapshot);
      } catch {
        drawingSnapshot = null;
      }
    }

    return Response.json({
      response: studentState?.responseText ?? response?.response ?? "",
      drawingPath: studentState?.drawingPath ?? response?.drawingPath ?? "",
      drawingText: studentState?.drawingText ?? "",
      drawingSnapshot,
      responseType: response?.responseType || "text",
    });
  }

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [responses, studentStates] = await Promise.all([
    prisma.lessonResponse.findMany({
      where: { slideId, sessionId },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.lessonStudentSlideState
      .findMany({
        where: { slideId, sessionId },
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      })
      .catch((err) => {
        if (isMissingTableError(err)) return [];
        throw err;
      }),
  ]);

  type Row = {
    id: string;
    response: string;
    responseType: string;
    drawingPath: string;
    drawingText: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      classPeriod?: string | null;
    };
    updatedAt: Date;
  };

  const rows = new Map<string, Row>();
  for (const response of responses) {
    rows.set(response.userId, {
      id: response.id,
      response: response.response || "",
      responseType: response.responseType || "text",
      drawingPath: response.drawingPath || "",
      drawingText: "",
      user: {
        id: response.userId,
        name: response.user?.name,
        email: response.user?.email,
        classPeriod: response.user?.classPeriod,
      },
      updatedAt: response.updatedAt,
    });
  }

  for (const state of studentStates) {
    const existing = rows.get(state.userId);
    if (existing && existing.updatedAt > state.updatedAt) continue;
    rows.set(state.userId, {
      id: existing?.id || state.id,
      response: state.responseText || existing?.response || "",
      responseType: existing?.responseType || "text",
      drawingPath: state.drawingPath || existing?.drawingPath || "",
      drawingText: state.drawingText || "",
      user: {
        id: state.userId,
        name: state.user?.name || existing?.user.name,
        email: state.user?.email || existing?.user.email,
        classPeriod: state.user?.classPeriod || existing?.user.classPeriod,
      },
      updatedAt: state.updatedAt,
    });
  }

  return Response.json(
    Array.from(rows.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((row) => ({
        id: row.id,
        response: row.response,
        responseType: row.responseType,
        drawingPath: row.drawingPath,
        drawingText: row.drawingText,
        user: row.user,
        updatedAt: row.updatedAt,
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
  const drawingPath = typeof body?.drawingPath === "string" ? body.drawingPath : undefined;
  const drawingText = typeof body?.drawingText === "string" ? body.drawingText : undefined;
  const drawingSnapshotValue = body?.drawingSnapshot;
  const drawingSnapshot =
    drawingSnapshotValue === null
      ? null
      : drawingSnapshotValue && typeof drawingSnapshotValue === "object"
      ? JSON.stringify(drawingSnapshotValue)
      : undefined;

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
    update: {
      response: responseText,
      responseType: responseType || "text",
      ...(typeof drawingPath === "string" ? { drawingPath } : {}),
    },
    create: {
      sessionId,
      slideId,
      userId: session.user.id,
      response: responseText,
      responseType: responseType || "text",
      drawingPath,
    },
  });

  const stateUpdate: Record<string, unknown> = { responseText };
  if (typeof drawingPath === "string") stateUpdate.drawingPath = drawingPath;
  if (typeof drawingText === "string") stateUpdate.drawingText = drawingText;
  if (drawingSnapshot !== undefined) stateUpdate.drawingSnapshot = drawingSnapshot;

  const stateCreate: Record<string, unknown> = {
    sessionId,
    slideId,
    userId: session.user.id,
    responseText,
  };
  if (typeof drawingPath === "string") stateCreate.drawingPath = drawingPath;
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
        console.warn("lesson-response state upsert skipped (readonly db)");
      }
    } else {
      throw err;
    }
  }

  emitRealtime("lesson:update", { sessionId, source: "lesson-response" });
  return new Response("OK");
}
