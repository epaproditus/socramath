import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";


export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const questionIndex = body?.questionIndex as number | undefined;

  if (!sessionId || typeof questionIndex !== "number") {
    return new NextResponse("Missing sessionId or questionIndex", { status: 400 });
  }

  await prisma.studentSessionState.upsert({
    where: { sessionId_userId: { sessionId, userId: session.user.id } },
    update: { currentQuestionIndex: questionIndex },
    create: { sessionId, userId: session.user.id, currentQuestionIndex: questionIndex },
  });

  return NextResponse.json({ ok: true });
}
