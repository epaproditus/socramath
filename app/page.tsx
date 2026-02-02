"use client";

import { useLocalRuntime, AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useAppStore } from "@/lib/store";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { useRef, useEffect } from "react";
import { SignIn } from "@/components/SignIn";

export default function Home() {
  const { currentSession, initialize } = useAppStore();
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

      // System Prompt - NOW DYNAMIC FROM STORE
      const systemMessage = {
        role: "system",
        content: `You are a Socratic Tutor conducting a "Test Correction" interview.

        INSTRUCTIONS:
        1. Context: The student took a test and got some questions wrong.
        2. Goal: Review each question one by one. Guide the student to find their own mistake.
        3. STARTING: Call 'display_question' for Question 1 (index 1).
        4. Loop:
           - Display Question using 'display_question'.
           - Ask student to explain their thought process.
           - Use the Rubric to guide them.
           - When they get it right, say "Great job!" and move to the next question.
           - If done, wrap up.

        SESSION DATA:
        Title: ${currentSession.title}
        Student Name: ${currentSession.studentProfile?.name || "Student"}
        Questions: ${JSON.stringify(currentSession.questions)}
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

      <AssistantRuntimeProvider runtime={runtime}>
        <Thread />
      </AssistantRuntimeProvider>

      {/* Teacher Mode Toggle */}
      <Link href="/teacher" className="fixed bottom-4 left-4 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-full shadow-lg hover:scale-110 transition-transform text-zinc-500 hover:text-indigo-600 z-50">
        <Link2 className="w-5 h-5" />
      </Link>
    </div>
  );
}
