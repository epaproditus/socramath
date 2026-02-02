import { NextResponse } from 'next/server';

import { auth } from "@/auth";

export async function POST(req: Request) {
    const session = await auth();
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json();
        const apiKey = process.env.DEEPSEEK_API_KEY;
        console.log("DEBUG: Using API Key ending in:", apiKey ? apiKey.slice(-4) : "NONE");


        if (!apiKey) {
            return new NextResponse('Missing API Key', { status: 500 });
        }

        // Forward to DeepSeek
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
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
