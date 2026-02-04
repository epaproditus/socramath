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
  const question = (body?.question as string | undefined)?.trim();
  if (!question) {
    return new NextResponse("Missing question", { status: 400 });
  }

  const config = await prisma.appConfig.findFirst();
  const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = config?.baseUrl || "https://api.deepseek.com";
  if (!apiKey) {
    return new NextResponse("Missing API Key", { status: 500 });
  }

  const system = `You create grading rubrics for math word problems.
Return ONLY JSON: {"rubric":["criterion 1","criterion 2","criterion 3"]}.
Criteria should be short, concrete, and ordered from conceptual to procedural.`;

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
        { role: "user", content: question },
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
    const parsed = JSON.parse(content);
    return NextResponse.json(parsed);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return new NextResponse("Invalid LLM response", { status: 500 });
    return NextResponse.json(JSON.parse(match[0]));
  }
}
