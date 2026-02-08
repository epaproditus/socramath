import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";

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
  const _lessonContext = searchParams.get("context");

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

  const adminEmail = process.env.ADMIN_EMAIL;
  let lessonTitle = "Lesson";
  let lessonContent = LESSON_CONTENT_INTERNAL;
  let slideContext = "";

  if (adminEmail) {
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (adminUser) {
      const activeLesson = await prisma.lesson.findFirst({
        where: { userId: adminUser.id, isActive: true },
        orderBy: { updatedAt: "desc" },
      });
      if (activeLesson?.content) {
        lessonTitle = activeLesson.title || "Lesson";
        lessonContent = activeLesson.content;
        const sessionRow = await prisma.lessonSession.findFirst({
          where: { lessonId: activeLesson.id, isActive: true },
          orderBy: { updatedAt: "desc" },
        });
        if (sessionRow && session?.user?.id) {
          let currentIndex = sessionRow.currentSlideIndex;
          if (sessionRow.mode === "student") {
            const state = await prisma.lessonSessionState.findUnique({
              where: {
                sessionId_userId: {
                  sessionId: sessionRow.id,
                  userId: session.user.id,
                },
              },
            });
            if (state?.currentSlideIndex) currentIndex = state.currentSlideIndex;
          }
          const slide = await prisma.lessonSlide.findFirst({
            where: { lessonId: activeLesson.id, index: currentIndex },
          });
          slideContext = slide?.text || "";
          if (slide?.responseConfig) {
            try {
              const config = JSON.parse(slide.responseConfig);
              if (Array.isArray(config?.choices) && config.choices.length) {
                const choiceLabel = config.multi ? "CHOICES (multi-select)" : "CHOICES";
                slideContext += `\n\n${choiceLabel}:\n- ${config.choices.join("\n- ")}`;
              }
            } catch {
              // ignore invalid JSON
            }
          }
        }
      }
    }
  }

  /*
   * RESTORED: Tool calling with STRING parameter to fix DeepSeek schema issue.
   * DeepSeek often rejects empty/boolean tools.
   */
  const systemPrompt = `You are a Socratic tutor. Your goal is not to give answers, but to help the student build a defense for their argument. Challenge their assumptions gently and ask for evidence.
  
  CURRENT LESSON CONTEXT:
  ${lessonContent}

  CURRENT SLIDE CONTEXT:
  ${slideContext}
  
  IMPORTANT:
  If this is the start of the conversation, you MUST call the "display_lesson" tool to show the lesson content to the student.
  Use:
  - title: "${lessonTitle}"
  - content: the full lesson text above
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
          title: z.string().describe("Lesson title to display."),
          content: z.string().describe("Full lesson text for the student to read."),
          reason: z.string().describe("The reason for displaying the lesson (e.g. 'Intro')."),
        }).strict(),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
