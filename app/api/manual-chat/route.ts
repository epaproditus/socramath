import { NextResponse } from 'next/server';
import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
    const session = await auth();
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json();
        const config = await prisma.appConfig.findFirst();
        const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || "";
        const baseUrl = config?.baseUrl || "https://api.deepseek.com";

        if (!apiKey) {
            return new NextResponse('Missing API Key', { status: 500 });
        }

        const endpoint = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                ...body,
                model: config?.model || body?.model || "deepseek-chat",
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("DeepSeek API Error:", errorText);
            return new NextResponse(errorText, { status: response.status });
        }

        // Stream the response back
        return new NextResponse(response.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        console.error("Proxy Error:", error);
        return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}
