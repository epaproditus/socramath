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
  const rubric = (body?.rubric as string[] | undefined) || [];

  if (!rubric.length) {
    return NextResponse.json({ goals: [] });
  }

  const config = await prisma.appConfig.findFirst();
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = config?.baseUrl || "https://api.deepseek.com";
  if (!apiKey) {
    return NextResponse.json({ goals: rubric.slice(0, 4) });
  }

  const system = `You rewrite teacher rubric points into student-friendly goals for 7th graders.
Return ONLY JSON: {"goals":["goal 1","goal 2","goal 3"]}.
Keep goals short, concrete, and do not reveal the final answer.`;

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
        { role: "user", content: JSON.stringify({ rubric }) },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new NextResponse(errorText, { status: 500 });
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  try {
    return NextResponse.json(JSON.parse(content));
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ goals: rubric.slice(0, 4) });
    return NextResponse.json(JSON.parse(match[0]));
  }
}
