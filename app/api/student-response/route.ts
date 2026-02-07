import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/auth";


type ResponsePayload = {
  sessionId: string;
  questionId: string;
  initialReasoning?: string | null;
  difficulty?: number | null;
  confidence?: number | null;
  revisedAnswer?: string | null;
  forceSummarize?: boolean;
};

async function generateSummary(input: {
  initialReasoning?: string | null;
  difficulty?: number | null;
  confidence?: number | null;
  revisedAnswer?: string | null;
}) {
  return null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const questionId = searchParams.get("questionId");

  if (!sessionId || !questionId) {
    return new NextResponse("Missing sessionId or questionId", { status: 400 });
  }

  const existing = await prisma.studentResponse.findUnique({
    where: {
      userId_sessionId_questionId: {
        userId: session.user.id,
        sessionId,
        questionId,
      },
    },
  });

  return NextResponse.json(existing || null);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as ResponsePayload;
  const { sessionId, questionId } = body;

  if (!sessionId || !questionId) {
    return new NextResponse("Missing sessionId or questionId", { status: 400 });
  }

  const existing = await prisma.studentResponse.findUnique({
    where: {
      userId_sessionId_questionId: {
        userId: session.user.id,
        sessionId,
        questionId,
      },
    },
  });

  let summary: string | null | undefined = undefined;

  const saved = await prisma.studentResponse.upsert({
    where: {
      userId_sessionId_questionId: {
        userId: session.user.id,
        sessionId,
        questionId,
      },
    },
    update: {
      initialReasoning: body.initialReasoning ?? undefined,
      difficulty: body.difficulty ?? undefined,
      confidence: body.confidence ?? undefined,
      revisedAnswer: body.revisedAnswer ?? undefined,
      summary: summary ?? undefined,
    },
    create: {
      userId: session.user.id,
      sessionId,
      questionId,
      initialReasoning: body.initialReasoning ?? null,
      difficulty: body.difficulty ?? null,
      confidence: body.confidence ?? null,
      revisedAnswer: body.revisedAnswer ?? null,
      summary: summary ?? null,
    },
  });

  return NextResponse.json(saved);
}
