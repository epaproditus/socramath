import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const sessionId = body?.sessionId as string | undefined;
  const slideId = body?.slideId as string | undefined;
  const studentId = body?.studentId as string | undefined;

  if (!sessionId || (!slideId && !studentId)) {
    return new NextResponse("Missing sessionId and target", { status: 400 });
  }

  const lessonSession = await prisma.lessonSession.findUnique({
    where: { id: sessionId },
    include: { lesson: true },
  });
  if (!lessonSession) {
    return new NextResponse("Lesson session not found", { status: 404 });
  }

  const config = await prisma.appConfig.findFirst();
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  let baseUrl = config?.baseUrl || "https://api.deepseek.com";
  if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  if (baseUrl.endsWith("/v1")) baseUrl = baseUrl.slice(0, -3);
  if (!apiKey) {
    return new NextResponse("Missing API Key", { status: 500 });
  }

  const slides = await prisma.lessonSlide.findMany({
    where: { lessonId: lessonSession.lessonId },
    select: { id: true, index: true },
  });
  const slideIndexMap = new Map(slides.map((s) => [s.id, s.index]));

  if (slideId) {
    const responses = await prisma.lessonResponse.findMany({
      where: { sessionId, slideId },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    });

    const textSamples = responses
      .filter((r) => r.response && r.response.trim())
      .slice(0, 12)
      .map((r) => `- ${r.user?.name || r.user?.email || "Student"}: ${r.response?.slice(0, 240)}`);

    const drawingOnlyCount = responses.filter((r) => r.drawingPath && !(r.response || "").trim()).length;
    const textCount = responses.filter((r) => (r.response || "").trim()).length;
    const total = responses.length;

    const system = `You summarize a class's progress on a single slide.
Output 4-6 bullet points. Focus on common misconceptions, progress, and who might need help.
Do not reveal final answers. Keep it concise and teacher-friendly.`;

    const user = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Slide index: ${slideIndexMap.get(slideId) || "?"}`,
      `Total responses: ${total}`,
      `Text responses: ${textCount}`,
      `Drawing-only responses: ${drawingOnlyCount}`,
      `Sample responses:`,
      ...(textSamples.length ? textSamples : ["- (No text responses yet)"])
    ].join("\n");

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config?.model || "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Lesson summary API error:", errorText);
      return new NextResponse(errorText, { status: 500 });
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() || "";
    return NextResponse.json({ ok: true, summary });
  }

  if (studentId) {
    const responses = await prisma.lessonResponse.findMany({
      where: { sessionId, userId: studentId },
      include: { user: true, slide: true },
      orderBy: { updatedAt: "desc" },
    });

    const name = responses[0]?.user?.name || responses[0]?.user?.email || "Student";
    const samples = responses
      .slice(0, 12)
      .map((r) => {
        const idx = slideIndexMap.get(r.slideId) || r.slide?.index || "?";
        const text = (r.response || "").trim();
        return `- Slide ${idx}: ${text ? text.slice(0, 200) : "(drawing only)"}`;
      });

    const system = `You summarize a single student's progress across multiple slides.
Output 4-6 bullet points. Focus on strengths, misconceptions, and next steps.
Do not reveal final answers. Keep it concise and teacher-friendly.`;

    const user = [
      `Lesson: ${lessonSession.lesson.title}`,
      `Student: ${name}`,
      `Total responses: ${responses.length}`,
      `Recent responses:`,
      ...(samples.length ? samples : ["- (No responses yet)"])
    ].join("\n");

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config?.model || "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Lesson summary API error:", errorText);
      return new NextResponse(errorText, { status: 500 });
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() || "";
    return NextResponse.json({ ok: true, summary });
  }

  return new NextResponse("Invalid request", { status: 400 });
}
