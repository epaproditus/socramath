import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";

import { auth } from "@/auth";

// Create a custom OpenAI provider instance pointing to DeepSeek
const deepseekProvider = createOpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { messages } = body;

  // Get context from Query Params
  const { searchParams } = new URL(req.url);
  const lessonContext = searchParams.get("context");

  console.log("Incoming Messages Count:", messages.length);

  // Ensure content is a string for core messages
  const coreMessages = messages.map((m: any) => {
    let content = "";
    if (m.parts && Array.isArray(m.parts)) {
      content = m.parts.map((p: any) => {
        if (p.type === 'text') return p.text;
        return '';
      }).join('');
    } else if (typeof m.content === 'string') {
      content = m.content;
    }
    return {
      role: m.role,
      content: content || "",
    };
  });

  const LESSON_CONTENT_INTERNAL = `
    The French Revolution (1789-1799) is often celebrated for its ideals of Liberty, Equality, and Fraternity. However, from 1793 to 1794, the revolutionary government entered a phase known as the "Reign of Terror."
    Led by Maximilien Robespierre and the Committee of Public Safety, thousands of "enemies of the revolution" were executed by guillotine.
    Primary Question: "Was the Reign of Terror a necessary measure to save the Revolution from internal and external threats, or was it a betrayal of the Revolution's own principles?"
  `;

  /*
   * RESTORED: Tool calling with STRING parameter to fix DeepSeek schema issue.
   * DeepSeek often rejects empty/boolean tools.
   */
  const systemPrompt = `You are a Socratic tutor. Your goal is not to give answers, but to help the student build a defense for their argument. Challenge their assumptions gently and ask for evidence.
  
  CURRENT LESSON CONTEXT:
  ${LESSON_CONTENT_INTERNAL}
  
  IMPORTANT:
  If this is the start of the conversation, you MUST call the "display_lesson" tool to show the lesson content to the student.
  Then ask the student what position they would like to take on the primary question.`;

  const result = streamText({
    // IMPORTANT: explicit .chat() call to target /chat/completions (v1/chat/completions)
    model: deepseekProvider.chat("deepseek-chat"),
    messages: coreMessages,
    system: systemPrompt,
    tools: {
      display_lesson: tool({
        description: "Display the lesson content card to the user.",
        parameters: z.object({
          reason: z.string().describe("The reason for displaying the lesson (e.g. 'Intro')."),
        }).strict(),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
