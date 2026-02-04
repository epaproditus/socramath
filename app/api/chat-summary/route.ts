import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const questionId = body?.questionId as string | undefined;
  const transcript = (body?.transcript as string[] | undefined) || [];

  if (!sessionId || !questionId) {
    return new NextResponse("Missing sessionId or questionId", { status: 400 });
  }

  if (!transcript.length) {
    return NextResponse.json({ ok: true, summary: "" });
  }

  const config = await prisma.appConfig.findFirst();
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = config?.baseUrl || "https://api.deepseek.com";
  if (!apiKey) {
    return new NextResponse("Missing API Key", { status: 500 });
  }

  const system = `You summarize a tutoring conversation between a student and an AI coach.
Output 2-4 sentences. Focus on the student's misconception, their progress, and what they now understand.
Do not reveal the final answer. Keep it concise and teacher-friendly.`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config?.model || "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcript.join("\n") },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new NextResponse(errorText, { status: 500 });
  }

  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content?.trim() || "";

  await prisma.studentResponse.upsert({
    where: {
      userId_sessionId_questionId: {
        userId: session.user.id,
        sessionId,
        questionId,
      },
    },
    update: { summary },
    create: {
      userId: session.user.id,
      sessionId,
      questionId,
      summary,
    },
  });

  return NextResponse.json({ ok: true, summary });
}
