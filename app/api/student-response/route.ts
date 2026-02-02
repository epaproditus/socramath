import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { auth } from "@/auth";

const prisma = new PrismaClient();

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
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const messages = [
    {
      role: "system",
      content:
        "You summarize student test-review reflections. Output 2-4 sentences. Include difficulty/confidence, key misconception or gap, and their revised approach. Keep it concise and readable to a teacher.",
    },
    {
      role: "user",
      content: JSON.stringify({
        initialReasoning: input.initialReasoning || "",
        difficulty: input.difficulty ?? null,
        confidence: input.confidence ?? null,
        revisedAnswer: input.revisedAnswer || "",
      }),
    },
  ];

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("DeepSeek summary error:", errorText);
    return null;
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
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
  const shouldSummarize =
    !!body.revisedAnswer && (body.forceSummarize || !existing?.summary);

  if (shouldSummarize) {
    summary = await generateSummary({
      initialReasoning: body.initialReasoning,
      difficulty: body.difficulty,
      confidence: body.confidence,
      revisedAnswer: body.revisedAnswer,
    });
  }

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
