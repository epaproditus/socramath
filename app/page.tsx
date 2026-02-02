"use client";

import { useLocalRuntime, AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useAppStore } from "@/lib/store";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { useRef, useEffect } from "react";
import { SignIn } from "@/components/SignIn";
import { QuestionSidebar } from "@/components/QuestionSidebar";

export default function Home() {
  const { currentSession, initialize, studentResponses, sidebarOpen, sidebarWidth, setSidebarWidth, activeQuestionId } = useAppStore();
  const sessionRef = useRef(currentSession);

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

  // 1. Initial Load from localStorage (mock)
  const runtime = useLocalRuntime({
    run: async function* ({ messages, abortSignal }) {
      const currentSession = sessionRef.current; // ALWAYS READ FRESH
      const msgs = messages as any[]; // CAST TO ANY TO FIX TYPES
      const lastMessage = msgs[msgs.length - 1];
      if (!lastMessage) return;

      // 1. Build Payload
      const apiMessages = msgs.flatMap(m => {
        // Handle Assistant Messages with Tool Calls
        if (m.role === 'assistant') {
          const content = Array.isArray(m.content) ? m.content : [];
          const toolCalls = content.filter((c: any) => c.type === 'tool-call');
          const textContent = content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');

          const assistantMsg: any = {
            role: 'assistant',
            content: textContent || null // DeepSeek might prefer null if tool_calls exist
          };

          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls.map((tc: any) => ({
              id: tc.toolCallId,
              type: 'function',
              function: {
                name: tc.toolName,
                arguments: tc.argsText || JSON.stringify(tc.args)
              }
            }));

            // Extract Results into separate TOOL messages
            const toolResults = toolCalls
              .filter((tc: any) => tc.result !== undefined) // Only if we have a result
              .map((tc: any) => ({
                role: 'tool',
                tool_call_id: tc.toolCallId,
                content: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)
              }));

            return [assistantMsg, ...toolResults];
          }

          return [assistantMsg];
        }

        // Handle User Messages
        if (m.role === 'user') {
          const content = Array.isArray(m.content)
            ? m.content.map((c: any) => c.type === 'text' ? c.text : '').join('')
            : m.content;
          return [{ role: 'user', content }];
        }

        // Fallback for system or other roles
        return [{
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }];
      });

      const responseMap = studentResponses || {};
      const activeResponse = activeQuestionId ? responseMap[activeQuestionId] : null;
      const reviewComplete = !!(
        activeResponse?.difficulty &&
        activeResponse?.initialReasoning &&
        activeResponse?.confidence &&
        activeResponse?.revisedAnswer
      );

      // System Prompt - NOW DYNAMIC FROM STORE
      const systemMessage = {
        role: "system",
        content: `You are a Socratic Test Review Coach.

        CONTEXT:
        - The student already completed a structured review card for each question (difficulty, initial reasoning, confidence, revised answer).
        - Your job is to deepen their understanding, not to collect those fields again.

        INSTRUCTIONS:
        1. STARTING: Call 'display_question' for Question 1 (index 1).
        2. For the active question:
           - Assume you can see the student's review card responses.
           - Do NOT ask for their original answer, difficulty, or confidence.
           - If the review is incomplete, gently direct the student to finish the review card before continuing.
           - If the review is complete, sanity-check their revised answer against the rubric:
             - If it already matches, explicitly say it's correct and explain why in 1-2 sentences, then move on.
             - If it doesn't, ask one focused question that targets the misconception.
           - Use the rubric to guide them.
           - Encourage them to refine their revised answer only if it is not correct.
        3. When they demonstrate understanding, say "Great job!" and move to the next question.
        4. Keep messages concise and focused.

        SESSION DATA:
        Title: ${currentSession.title}
        Student Name: ${currentSession.studentProfile?.name || "Student"}
        Questions: ${JSON.stringify(currentSession.questions)}
        Active Question Id: ${activeQuestionId || "none"}
        Active Review Complete: ${reviewComplete}
        Active Review Response:
        ${JSON.stringify(activeResponse || null)}

        All Student Review Responses (keyed by question id):
        ${JSON.stringify(responseMap)}
        `
      };
      const payload = {
        model: "deepseek-chat",
        messages: [systemMessage, ...apiMessages],
        stream: true,
        tools: [
          {
            type: "function",
            function: {
              name: "display_question",
              description: "Display a specific question card to the student. ALWAYS provide the full text/image details from your instructions.",
              parameters: {
                type: "object",
                properties: {
                  question_number: { type: "number", description: "The 1-based index of the question" },
                  text: { type: "string" },
                  image_url: { type: "string" },
                  student_response: { type: "string" }
                },
                required: ["question_number", "text", "student_response"]
              }
            }
          }
        ]
      };

      // 2. Fetch
      const response = await fetch('/api/manual-chat', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.body) return;

      // 3. Handle Stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let currentText = "";
      let currentToolCall = { id: "", name: "", args: "" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim().startsWith("data: ")) {
            const jsonStr = line.trim().slice(6);
            if (jsonStr === "[DONE]") break;

            try {
              const json = JSON.parse(jsonStr);
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;

              // Accumulate Text
              if (delta.content) {
                currentText += delta.content;
              }

              // Accumulate Tool Calls
              if (delta.tool_calls) {
                const tc = delta.tool_calls[0];
                if (tc.id) currentToolCall.id = tc.id;
                if (tc.function?.name) currentToolCall.name = tc.function.name;
                if (tc.function?.arguments) currentToolCall.args += tc.function.arguments;
              }

              // Yield Update
              const content: any[] = [];
              if (currentText) {
                content.push({ type: "text", text: currentText });
              }
              if (currentToolCall.id) {
                let parsedArgs = {};
                try { parsedArgs = JSON.parse(currentToolCall.args); } catch { }

                content.push({
                  type: "tool-call",
                  toolCallId: currentToolCall.id,
                  toolName: currentToolCall.name,
                  argsText: currentToolCall.args,
                  args: parsedArgs
                });
              }

              if (content.length > 0) {
                yield { content };
              }

            } catch (e) {
              console.error("Parse Error", e);
            }
          }
        }
      }

      // 4. Final Tool Execution Logic (Client-Side)
      if (currentToolCall.id && (currentToolCall.name === "display_question" || currentToolCall.name.includes("display_question"))) {
        // Parse the args generated by DeepSeek
        let generatedArgs: any = { question_number: 1 }; // Default to 1
        try {
          generatedArgs = JSON.parse(currentToolCall.args);
        } catch (e) {
          console.error("JSON parse error", e);
        }

        // HYDRATE FROM SOURCE OF TRUTH (Store)
        // usage: question_number is 1-based index
        const qIndex = (generatedArgs.question_number || 1) - 1;
        const realQuestion = currentSession.questions[qIndex] || currentSession.questions[0];

        // Merge LLM args (which might be hallucinated or incomplete) with Real Data
        const argsWithMeta = {
          ...generatedArgs,
          // Enforce real data:
          text: realQuestion.text,
          image_url: realQuestion.image_url,
          student_response: realQuestion.student_response,
          // Meta:
          question_number: qIndex + 1,
          total_questions: currentSession.questions.length
        };

        yield {
          content: [
            { type: "text", text: currentText },
            {
              type: "tool-call",
              toolCallId: currentToolCall.id,
              toolName: "display_question",
              argsText: currentToolCall.args,
              args: argsWithMeta, // Pass the HYDRATED args to the UI
              result: { displayed: true }
            }
          ]
        };
      }
    },
  });

  return (
    <div className="fixed inset-0 h-dvh w-full bg-white dark:bg-zinc-950 flex flex-col">
      {/* Main Header */}
      <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-50 pointer-events-none">
        {/* Left: Brand or Empty */}
        <div></div>

        {/* Right: Auth */}
        <div className="pointer-events-auto bg-white/50 dark:bg-black/50 backdrop-blur-sm p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <SignIn />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row pt-12">
        <div className="flex-1 min-w-0">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread />
          </AssistantRuntimeProvider>
        </div>
        <aside
          className={`border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 overflow-y-auto transition-all duration-150 ${sidebarOpen ? "block" : "hidden lg:block"} ${sidebarOpen ? "" : "lg:w-0 lg:border-l-0"}`}
          style={sidebarOpen ? { width: sidebarWidth } : undefined}
        >
          {sidebarOpen && (
            <div className="relative h-full">
              <div
                className="absolute left-0 top-0 h-full w-2 cursor-col-resize"
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startWidth = sidebarWidth;

                  const onMove = (ev: MouseEvent) => {
                    const delta = startX - ev.clientX;
                    const next = Math.min(720, Math.max(360, startWidth + delta));
                    setSidebarWidth(next);
                  };

                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };

                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                title="Drag to resize"
              />
              <div className="p-4 lg:p-6">
                <QuestionSidebar />
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Teacher Mode Toggle */}
      <Link href="/teacher" className="fixed bottom-4 left-4 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-full shadow-lg hover:scale-110 transition-transform text-zinc-500 hover:text-indigo-600 z-50">
        <Link2 className="w-5 h-5" />
      </Link>
    </div>
  );
}
