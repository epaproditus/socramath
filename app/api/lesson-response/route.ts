import { auth } from "@/auth";
import { normalizeLessonResponseConfig } from "@/lib/lesson-blocks";
import {
  normalizeLessonResponseJson,
  parseLessonResponseJson,
  stringifyLessonResponseJson,
  summarizeLessonResponseJson,
} from "@/lib/lesson-response";
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

    const responseJson = parseLessonResponseJson(
      studentState?.responseJson ?? response?.responseJson ?? null
    );

    return Response.json({
      response: studentState?.responseText ?? response?.response ?? "",
      responseJson,
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
    responseJson: ReturnType<typeof parseLessonResponseJson>;
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
      responseJson: parseLessonResponseJson(response.responseJson),
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
      responseJson:
        parseLessonResponseJson(state.responseJson) || existing?.responseJson || null,
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
        responseJson: row.responseJson,
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
  const responseTextInput =
    typeof body?.response === "string" ? body.response : undefined;
  const responseTypeInput =
    typeof body?.responseType === "string" ? body.responseType : undefined;
  const drawingPath =
    typeof body?.drawingPath === "string" ? body.drawingPath : undefined;
  const drawingText =
    typeof body?.drawingText === "string" ? body.drawingText : undefined;
  const hasResponseJsonField = Object.prototype.hasOwnProperty.call(
    body || {},
    "responseJson"
  );
  const responseJsonInput = (body || {}).responseJson;
  const drawingSnapshotValue = body?.drawingSnapshot;
  const drawingSnapshot =
    drawingSnapshotValue === null
      ? null
      : drawingSnapshotValue && typeof drawingSnapshotValue === "object"
      ? JSON.stringify(drawingSnapshotValue)
      : undefined;

  if (!sessionId || !slideId) {
    return new Response("Missing sessionId or slideId", { status: 400 });
  }

  const [slide, existingResponse, existingState] = await Promise.all([
    prisma.lessonSlide.findUnique({
      where: { id: slideId },
      select: {
        id: true,
        prompt: true,
        responseType: true,
        responseConfig: true,
      },
    }),
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

  if (!slide) {
    return new Response("Slide not found", { status: 404 });
  }

  const slideResponseConfig = normalizeLessonResponseConfig(
    slide.responseConfig ? JSON.parse(slide.responseConfig) : {},
    {
      responseType: slide.responseType || "text",
      prompt: slide.prompt || "",
    }
  );

  const resolvedResponseJson = hasResponseJsonField
    ? responseJsonInput === null
      ? null
      : normalizeLessonResponseJson(responseJsonInput)
    : parseLessonResponseJson(
        existingState?.responseJson ?? existingResponse?.responseJson ?? null
      );
  const responseJsonString = stringifyLessonResponseJson(resolvedResponseJson);

  const effectiveDrawingPath =
    typeof drawingPath === "string"
      ? drawingPath
      : existingState?.drawingPath || existingResponse?.drawingPath || "";
  const effectiveDrawingText =
    typeof drawingText === "string"
      ? drawingText
      : existingState?.drawingText || "";
  const fallbackResponse =
    responseTextInput ??
    existingState?.responseText ??
    existingResponse?.response ??
    "";

  const derivedResponse = summarizeLessonResponseJson({
    blocks: slideResponseConfig.blocks,
    responseJson: resolvedResponseJson,
    fallbackText: fallbackResponse,
    drawingPath: effectiveDrawingPath,
    drawingText: effectiveDrawingText,
  });

  const responseText = derivedResponse || fallbackResponse || "";
  const responseType = responseTypeInput || existingResponse?.responseType || "text";

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
      responseJson: responseJsonString,
      responseType,
      ...(typeof drawingPath === "string" ? { drawingPath } : {}),
    },
    create: {
      sessionId,
      slideId,
      userId: session.user.id,
      response: responseText,
      responseJson: responseJsonString,
      responseType,
      drawingPath,
    },
  });

  const stateUpdate: {
    responseText: string;
    responseJson: string | null;
    drawingPath?: string;
    drawingText?: string;
    drawingSnapshot?: string | null;
  } = {
    responseText,
    responseJson: responseJsonString,
  };
  if (typeof drawingPath === "string") stateUpdate.drawingPath = drawingPath;
  if (typeof drawingText === "string") stateUpdate.drawingText = drawingText;
  if (drawingSnapshot !== undefined) stateUpdate.drawingSnapshot = drawingSnapshot;

  const stateCreate: {
    sessionId: string;
    slideId: string;
    userId: string;
    responseText: string;
    responseJson: string | null;
    drawingPath?: string;
    drawingText?: string;
    drawingSnapshot?: string | null;
  } = {
    sessionId,
    slideId,
    userId: session.user.id,
    responseText,
    responseJson: responseJsonString,
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
  return Response.json({
    ok: true,
    response: responseText,
    responseJson: resolvedResponseJson,
  });
}
