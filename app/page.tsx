"use client";

import { useLocalRuntime, AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useAppStore } from "@/lib/store";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { useRef, useEffect, useMemo, useState } from "react";
import { SignIn } from "@/components/SignIn";
import { QuestionSidebar } from "@/components/QuestionSidebar";
import LessonStage from "@/components/LessonStage";
import LessonChoiceWidget from "@/components/LessonChoiceWidget";
import { getRealtimeSocket } from "@/lib/realtime-client";

type LessonState = {
  lesson: {
    id: string;
    title: string;
    pageCount: number;
    content?: string;
  };
  session: {
    id: string;
    mode: "instructor" | "student";
    currentSlideIndex: number;
    isFrozen?: boolean;
    paceConfig?: { allowedSlides?: number[] } | null;
    timerEndsAt?: string | null;
    timerRemainingSec?: number | null;
    timerRunning?: boolean;
  };
  currentSlideIndex: number;
  currentSlideId: string | null;
  slideText?: string;
  slidePrompt?: string;
  slideRubric?: string[];
  slideResponseType?: string;
  slideResponseConfig?: Record<string, any>;
  slides: { id: string; index: number }[];
};

export default function Home() {
  const {
    currentSession,
    initialize,
    studentResponses,
    sidebarOpen,
    sidebarWidth,
    setSidebarOpen,
    setSidebarWidth,
    activeQuestionId,
    advanceRequestId,
    advanceTargetIndex,
    summaryRequestId,
    summaryQuestionId,
    nudgeRequestId,
    nudgeMessage,
    setGoalProgress,
    requestSummary,
  } = useAppStore();
  const sessionRef = useRef(currentSession);
  const [calcLarge, setCalcLarge] = useState(false);
  const [lessonTab, setLessonTab] = useState<"chat" | "calculator">("chat");
  const [activeExperience, setActiveExperience] = useState<"test" | "lesson">("lesson");
  const [lessonState, setLessonState] = useState<LessonState | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonDrawingTextBySlide, setLessonDrawingTextBySlide] = useState<Record<string, string>>({});
  const [lessonResponseText, setLessonResponseText] = useState("");
  const [lessonResponseSaving, setLessonResponseSaving] = useState(false);
  const lessonResponseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [lessonChoiceValue, setLessonChoiceValue] = useState("");
  const [lessonChoiceExplain, setLessonChoiceExplain] = useState("");
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const prevFrozenRef = useRef(false);

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    lessonStateRef.current = lessonState;
  }, [lessonState]);
  const lessonDrawingTextRef = useRef<Record<string, string>>({});
  useEffect(() => {
    lessonDrawingTextRef.current = lessonDrawingTextBySlide;
  }, [lessonDrawingTextBySlide]);

  useEffect(() => {
    activeExperienceRef.current = activeExperience;
  }, [activeExperience]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("calc-size");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (typeof parsed.large === "boolean") setCalcLarge(parsed.large);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "calc-size",
      JSON.stringify({ large: calcLarge })
    );
  }, [calcLarge]);

  useEffect(() => {
    if (activeExperience === "lesson") {
      setSidebarOpen(true);
    }
  }, [activeExperience, setSidebarOpen]);

  const loadLessonState = async (preferLesson = false) => {
    setLessonLoading(true);
    try {
      const res = await fetch("/api/lesson-state");
      if (!res.ok) {
        setLessonState(null);
        if (preferLesson) setActiveExperience("test");
        return;
      }
      const json = await res.json();
      setLessonState(json);
      if (preferLesson || activeExperienceRef.current === "test") {
        setActiveExperience("lesson");
      }
    } catch {
      setLessonState(null);
    } finally {
      setLessonLoading(false);
    }
  };

  const loadLessonResponse = async (sessionId: string, slideId: string) => {
    const res = await fetch(
      `/api/lesson-response?sessionId=${encodeURIComponent(sessionId)}&slideId=${encodeURIComponent(slideId)}&me=1`
    );
    if (!res.ok) {
      setLessonResponseText("");
      setLessonChoiceValue("");
      setLessonChoiceExplain("");
      return;
    }
    const json = await res.json();
    const responseText = json.response || "";
    setLessonResponseText(responseText);

    const responseType = lessonStateRef.current?.slideResponseType || "text";
    const widgets = lessonStateRef.current?.slideResponseConfig?.widgets || (
      responseType === "both" ? ["text", "drawing"] : [responseType]
    );
    if (!widgets.includes("choice")) {
      setLessonChoiceValue("");
      setLessonChoiceExplain("");
      return;
    }
    const explain = !!lessonStateRef.current?.slideResponseConfig?.explain;
    if (explain) {
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && typeof parsed === "object") {
          const selection = (parsed as any).selection ?? "";
          const explainText = (parsed as any).explain ?? "";
          if (Array.isArray(selection)) {
            setLessonChoiceValue(JSON.stringify(selection));
          } else {
            setLessonChoiceValue(typeof selection === "string" ? selection : "");
          }
          setLessonChoiceExplain(typeof explainText === "string" ? explainText : "");
          return;
        }
      } catch {
        // ignore parse errors
      }
    }
    setLessonChoiceValue(responseText);
    setLessonChoiceExplain("");
  };

  const saveLessonResponse = async (
    sessionId: string,
    slideId: string,
    responseType: string,
    responseText: string
  ) => {
    if (lessonStateRef.current?.session?.isFrozen) return;
    setLessonResponseSaving(true);
    await fetch("/api/lesson-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, slideId, response: responseText, responseType }),
    }).catch(() => {});
    setLessonResponseSaving(false);
  };

  const handleLessonSlideChange = async (nextIndex: number) => {
    if (!lessonState) return;
    if (lessonState.session?.isFrozen) return;
    const allowed = Array.isArray(lessonState.session?.paceConfig?.allowedSlides)
      ? lessonState.session.paceConfig.allowedSlides
      : null;
    let targetIndex = nextIndex;
    if (allowed && allowed.length && !allowed.includes(nextIndex)) {
      const sorted = Array.from(new Set(allowed)).sort((a, b) => a - b);
      const direction = nextIndex > lessonState.currentSlideIndex ? 1 : -1;
      if (direction > 0) {
        targetIndex =
          sorted.find((idx) => idx > lessonState.currentSlideIndex) ??
          lessonState.currentSlideIndex;
      } else {
        const prev = [...sorted].reverse().find((idx) => idx < lessonState.currentSlideIndex);
        targetIndex = prev ?? lessonState.currentSlideIndex;
      }
      if (targetIndex === lessonState.currentSlideIndex) return;
    }
    const max = lessonState.lesson.pageCount || lessonState.slides.length || 1;
    const clamped = Math.max(1, Math.min(targetIndex, max));
    setLessonState({ ...lessonState, currentSlideIndex: clamped });
    await fetch("/api/lesson-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: lessonState.session.id, currentSlideIndex: clamped }),
    });
    await loadLessonState();
  };

  const handleLessonDrawing = async (dataUrl: string) => {
    if (!lessonState?.session.id || !lessonState.currentSlideId) return;
    await fetch("/api/lesson-drawing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: lessonState.session.id,
        slideId: lessonState.currentSlideId,
        dataUrl,
      }),
    });
  };

  const handleDrawingChange = (dataUrl: string) => {
    if (drawingSaveTimer.current) clearTimeout(drawingSaveTimer.current);
    drawingSaveTimer.current = setTimeout(() => {
      handleLessonDrawing(dataUrl);
    }, 700);
  };

  useEffect(() => {
    loadLessonState(true);
  }, []);

  useEffect(() => {
    if (!lessonState?.lesson?.id || !lessonState?.session?.id) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    socket.emit("join", { lessonId: lessonState.lesson.id, sessionId: lessonState.session.id });
    const handleUpdate = (payload: { lessonId?: string; sessionId?: string }) => {
      if (payload.sessionId && payload.sessionId !== lessonState.session.id) return;
      if (payload.lessonId && payload.lessonId !== lessonState.lesson.id) return;
      loadLessonState();
    };
    socket.on("lesson:update", handleUpdate);
    return () => {
      socket.off("lesson:update", handleUpdate);
    };
  }, [lessonState?.lesson?.id, lessonState?.session?.id]);

  useEffect(() => {
    if (!lessonState?.session.id || !lessonState.currentSlideId) return;
    loadLessonResponse(lessonState.session.id, lessonState.currentSlideId);
  }, [lessonState?.session.id, lessonState?.currentSlideId]);

  useEffect(() => {
    if (!lessonState?.session.id || !lessonState.currentSlideId) return;
    const responseType = lessonState.slideResponseType || "text";
    const widgets = lessonState.slideResponseConfig?.widgets || (
      responseType === "both" ? ["text", "drawing"] : [responseType]
    );
    if (!widgets.includes("choice")) return;
    const explain = !!lessonState.slideResponseConfig?.explain;
    const multi = !!lessonState.slideResponseConfig?.multi;
    let payload = lessonChoiceValue;
    if (explain) {
      let selection: string | string[] = lessonChoiceValue;
      if (multi) {
        try {
          const parsed = JSON.parse(lessonChoiceValue);
          if (Array.isArray(parsed)) selection = parsed;
        } catch {
          selection = [];
        }
      }
      payload = JSON.stringify({
        selection,
        explain: lessonChoiceExplain || "",
      });
    }
    if (lessonResponseTimerRef.current) clearTimeout(lessonResponseTimerRef.current);
    lessonResponseTimerRef.current = setTimeout(() => {
      saveLessonResponse(lessonState.session.id, lessonState.currentSlideId!, responseType, payload);
    }, 700);
    return () => {
      if (lessonResponseTimerRef.current) clearTimeout(lessonResponseTimerRef.current);
    };
  }, [
    lessonChoiceValue,
    lessonChoiceExplain,
    lessonState?.session.id,
    lessonState?.currentSlideId,
    lessonState?.slideResponseType,
    lessonState?.slideResponseConfig,
  ]);

  useEffect(() => {
    if (!lessonState || activeExperienceRef.current !== "lesson") return;
    const shouldPoll =
      lessonState.session.mode === "instructor" ||
      !!lessonState.session.timerRunning ||
      !!lessonState.session.isFrozen;
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      loadLessonState();
    }, 2000);
    return () => clearInterval(interval);
  }, [
    lessonState?.session.id,
    lessonState?.session.mode,
    lessonState?.session.timerRunning,
    lessonState?.session.isFrozen,
  ]);

  useEffect(() => {
    if (!lessonState?.session?.timerRunning) return;
    const interval = setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [lessonState?.session?.timerRunning, lessonState?.session?.timerEndsAt]);

  useEffect(() => {
    const isFrozen = !!lessonState?.session?.isFrozen;
    if (!prevFrozenRef.current && isFrozen) {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 640;
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          audioCtx.close();
        }, 180);
      } catch {
        // ignore audio errors
      }
    }
    prevFrozenRef.current = isFrozen;
  }, [lessonState?.session?.isFrozen]);

  const remainingSeconds = useMemo(() => {
    if (!lessonState?.session) return 0;
    if (lessonState.session.timerRunning && lessonState.session.timerEndsAt) {
      const end = new Date(lessonState.session.timerEndsAt).getTime();
      return Math.max(0, Math.floor((end - timerNow) / 1000));
    }
    if (typeof lessonState.session.timerRemainingSec === "number") {
      return Math.max(0, lessonState.session.timerRemainingSec);
    }
    return 0;
  }, [lessonState?.session, timerNow]);

  const formatTime = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  // bottom-left / bottom-right toggle only

  const runtimeRef = useRef<any>(null);
  const messageIndexRef = useRef(0);
  const questionStartIndexRef = useRef<Record<string, number>>({});
  const lastQuestionIdRef = useRef<string | null>(null);
  const lessonStateRef = useRef<LessonState | null>(null);
  const activeExperienceRef = useRef<"test" | "lesson">("lesson");
  const drawingSaveTimer = useRef<NodeJS.Timeout | null>(null);

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

          if (!textContent && toolCalls.length === 0) {
            return [];
          }

          const assistantMsg: any = {
            role: 'assistant',
            content: textContent || "" // keep non-null for API validation
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
        activeResponse?.confidence
      );

      const lessonState = lessonStateRef.current;
      const isLesson = activeExperienceRef.current === "lesson" && !!lessonState;
      const drawingTextMap = lessonDrawingTextRef.current || {};
      const drawingTextSummary = (() => {
        if (!lessonState?.slides?.length) return "";
        const byIndex = new Map(lessonState.slides.map((s) => [s.id, s.index]));
        const entries = Object.entries(drawingTextMap)
          .filter(([, text]) => text && text.trim().length > 0)
          .sort((a, b) => (byIndex.get(a[0]) || 0) - (byIndex.get(b[0]) || 0))
          .slice(0, 12)
          .map(([id, text]) => {
            const idx = byIndex.get(id) || "?";
            const cleaned = text.replace(/\s+/g, " ").trim();
            return `Slide ${idx}: ${cleaned.slice(0, 200)}`;
          });
        return entries.length ? entries.join("\n") : "None.";
      })();
      let globalPrompt = "";
      try {
        const res = await fetch("/api/app-config");
        if (res.ok) {
          const cfg = await res.json();
          globalPrompt = cfg?.systemPrompt || "";
        }
      } catch {
        // ignore
      }

      // System Prompt - dynamic by experience
      const systemMessage = isLesson
        ? {
            role: "system",
            content: `You are a Socratic lesson tutor. Your goal is to help the student think deeply about the current slide and lesson, not to give answers.

            LESSON TITLE: ${lessonState?.lesson.title || "Lesson"}
            LESSON CONTEXT:
            ${lessonState?.lesson.content || "No lesson context available."}

            CURRENT SLIDE: ${lessonState?.currentSlideIndex || 1}
            SLIDE CONTEXT:
            ${lessonState?.slideText || "No slide text extracted."}
            SLIDE PROMPT:
            ${lessonState?.slidePrompt || "No prompt provided."}

            SLIDE RUBRIC:
            ${lessonState?.slideRubric?.length ? lessonState.slideRubric.join(" | ") : "No rubric provided."}

            SLIDE RESPONSE TYPE:
            ${lessonState?.slideResponseType || "text"}

            PACING MODE: ${lessonState?.session.mode || "instructor"}

            STUDENT DRAWING TEXT (from annotations on the slide):
            ${lessonState?.currentSlideId && drawingTextMap[lessonState.currentSlideId]
              ? drawingTextMap[lessonState.currentSlideId].slice(0, 800)
              : "None."}

            STUDENT DRAWING TEXT (other slides):
            ${drawingTextSummary}

            INSTRUCTIONS:
            - Ask 1 focused, open-ended question at a time.
            - Push for reasoning and evidence.
            - If the student asks for answers, guide them with hints and questions instead.
            - If the student asks to move slides and pacing is instructor, tell them the teacher controls it.
            - If the student asks what slide they are on, answer exactly: "You're on slide ${lessonState?.currentSlideIndex || 1}."
            - You are given student annotation text in STUDENT DRAWING TEXT. Use it when present.
            - Never claim you cannot see what the student typed if STUDENT DRAWING TEXT is not "None.".

            GLOBAL TEACHER PROMPT:
            ${globalPrompt || "None."}`,
          }
        : {
            role: "system",
            content: `You are a Socratic Test Review Coach.

        CONTEXT:
        - The student already completed a structured review card for each question (difficulty, initial reasoning, confidence).
        - Your job is to deepen their understanding, not to collect those fields again.

        INSTRUCTIONS:
        1. STARTING: Call 'display_question' for the student's current question if provided, otherwise Question 1.
        2. For the active question:
           - Assume you can see the student's review card responses.
           - Do NOT ask for their original answer, difficulty, or confidence.
           - If the review is incomplete, direct the student to finish the review card before continuing.
           - If the review is complete, sanity-check their reasoning against the rubric:
             - If it already matches, confirm progress without giving the full answer. Ask them to state the key idea in their own words.
             - If it doesn't, ask one focused question that targets the misconception.
           - Use the rubric to guide them.
           - Goals are derived from the rubric in the same order; use goal_index to match that order.
           - Encourage them to refine their reasoning only if it is not correct.
           - NEVER give the final answer directly or reveal the answer key. Guide with questions and hints only.
           - Be strict: do not mark them as done unless they meet all rubric points.
           - If they meet a rubric goal, call 'mark_goal_complete' with the goal index.
           - If they meet all rubric points, call 'unlock_mark_done' for the current question.
           - Do not mention their original test answer until they have completed the reflection steps.
           - Use 7th-grade vocabulary and sentence structure.
        3. When they demonstrate understanding, say "Great job!" and move to the next question.
        4. Keep messages concise and focused.

        SESSION DATA:
        Title: ${currentSession.title}
        Student Name: ${currentSession.studentProfile?.name || "Student"}
        Questions: ${JSON.stringify(currentSession.questions)}
        Active Question Id: ${activeQuestionId || "none"}
        Pacing Lock (max question index): ${currentSession.studentLockIndex ?? currentSession.lockQuestionIndex ?? "none"}
        Student Current Question Index: ${currentSession.studentCurrentIndex ?? "none"}
        Active Review Complete: ${reviewComplete}
        Active Review Response:
        ${JSON.stringify(activeResponse || null)}

        All Student Review Responses (keyed by question id):
        ${JSON.stringify(responseMap)}

        GLOBAL TEACHER PROMPT:
        ${globalPrompt || "None."}
        `
          };
      const tools = isLesson
        ? []
        : [
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
          },
          {
            type: "function",
            function: {
              name: "unlock_mark_done",
              description: "Enable the Mark as Done button for the current question when rubric is met.",
              parameters: {
                type: "object",
                properties: {
                  question_number: { type: "number", description: "The 1-based index of the question" }
                },
                required: ["question_number"]
              }
            }
          }
          ,
          {
            type: "function",
            function: {
              name: "mark_goal_complete",
              description: "Mark a specific student-facing goal as completed for the current question.",
              parameters: {
                type: "object",
                properties: {
                  question_number: { type: "number", description: "The 1-based index of the question" },
                  goal_index: { type: "number", description: "0-based index of the goal" }
                },
                required: ["question_number", "goal_index"]
              }
            }
          }
        ];
      const payload = {
        model: "",
        messages: [systemMessage, ...apiMessages],
        stream: true,
        tools,
      };

      // 2. Fetch
      let response: Response;
      try {
        response = await fetch('/api/manual-chat', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortSignal,
        });
      } catch (err) {
        console.error("Failed to fetch /api/manual-chat", err);
        yield {
          content: [
            { type: "text", text: "I couldn't reach the tutor right now. Please try again in a moment." }
          ]
        };
        return;
      }

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => "");
        console.error("manual-chat error", response.status, errorText);
        yield {
          content: [
            { type: "text", text: "The tutor is unavailable right now. Please try again in a moment." }
          ]
        };
        return;
      }

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
        const preferred = currentSession.studentCurrentIndex || 1;
        const requested = generatedArgs.question_number || 1;
        const finalNumber = requested === 1 && preferred > 1 ? preferred : requested;
        const qIndex = finalNumber - 1;
        const realQuestion = currentSession.questions[qIndex] || currentSession.questions[0];

        // Merge LLM args (which might be hallucinated or incomplete) with Real Data
        const argsWithMeta = {
          ...generatedArgs,
          // Enforce real data:
          text: realQuestion.text,
          image_url: realQuestion.image_url,
          student_response: responseMap?.[realQuestion.id]?.originalAnswer || "",
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

      if (currentToolCall.id && (currentToolCall.name === "unlock_mark_done" || currentToolCall.name.includes("unlock_mark_done"))) {
        let generatedArgs: any = { question_number: 1 };
        try {
          generatedArgs = JSON.parse(currentToolCall.args);
        } catch (e) {
          console.error("JSON parse error", e);
        }

        yield {
          content: [
            { type: "text", text: currentText },
            {
              type: "tool-call",
              toolCallId: currentToolCall.id,
              toolName: "unlock_mark_done",
              argsText: currentToolCall.args,
              args: generatedArgs,
              result: { unlocked: true }
            }
          ]
        };
      }

      if (currentToolCall.id && (currentToolCall.name === "mark_goal_complete" || currentToolCall.name.includes("mark_goal_complete"))) {
        let generatedArgs: any = { question_number: 1, goal_index: 0 };
        try {
          generatedArgs = JSON.parse(currentToolCall.args);
        } catch (e) {
          console.error("JSON parse error", e);
        }

        const qIndex = Math.max(1, Number(generatedArgs.question_number || 1)) - 1;
        const qId = currentSession.questions[qIndex]?.id;
        if (qId && typeof generatedArgs.goal_index === "number") {
          setGoalProgress(qId, generatedArgs.goal_index, true);
        }

        yield {
          content: [
            { type: "text", text: currentText },
            {
              type: "tool-call",
              toolCallId: currentToolCall.id,
              toolName: "mark_goal_complete",
              argsText: currentToolCall.args,
              args: generatedArgs,
              result: { marked: true }
            }
          ]
        };
      }
    },
  });

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    if (!runtimeRef.current) return;
    const rt = runtimeRef.current;
    const unsub = rt.thread.subscribe(() => {
      const state = rt.thread.getState();
      const msgs = state.messages || [];
      for (let i = messageIndexRef.current; i < msgs.length; i += 1) {
        const m = msgs[i];
        if (m?.role !== "assistant") continue;
        const content = Array.isArray(m.content) ? m.content : [];
        const tool = content.find((c: any) => c.type === "tool-call" && (c.toolName === "display_question" || String(c.toolName || "").includes("display_question")));
        if (!tool) continue;
        let qnum = tool.args?.question_number;
        if (!qnum && tool.argsText) {
          try {
            const parsed = JSON.parse(tool.argsText);
            qnum = parsed.question_number;
          } catch {
            qnum = undefined;
          }
        }
        const idx = Math.max(1, Number(qnum || 1)) - 1;
        const qId = currentSession.questions[idx]?.id;
        if (qId) {
          questionStartIndexRef.current[qId] = i;
        }
      }
      messageIndexRef.current = msgs.length;
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [runtime, currentSession.questions]);

  useEffect(() => {
    if (!advanceRequestId) return;
    const target = advanceTargetIndex || currentSession.studentCurrentIndex || 1;
    const rt = runtimeRef.current;
    if (!rt?.thread) return;
    rt.thread.append({
      role: "user",
      content: `I completed this question. Please move me to Question ${target}.`,
    });
    rt.thread.startRun(null);
  }, [advanceRequestId, advanceTargetIndex, currentSession.studentCurrentIndex]);

  useEffect(() => {
    if (!summaryRequestId) return;
    const questionId = summaryQuestionId;
    if (!questionId) return;
    const rt = runtimeRef.current;
    if (!rt?.thread) return;
    const msgs = rt.thread.getState().messages || [];
    const start = questionStartIndexRef.current[questionId] ?? 0;
    const slice = msgs.slice(start);
    const transcript = slice.flatMap((m: any) => {
      if (m.role === "user") {
        if (typeof m.content === "string") return [`User: ${m.content}`];
        if (Array.isArray(m.content)) {
          const text = m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
          return text ? [`User: ${text}`] : [];
        }
      }
      if (m.role === "assistant") {
        if (typeof m.content === "string") return [`Assistant: ${m.content}`];
        if (Array.isArray(m.content)) {
          const text = m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
          return text ? [`Assistant: ${text}`] : [];
        }
      }
      return [];
    });

    fetch("/api/chat-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: currentSession.id,
        questionId,
        transcript,
      }),
    }).catch(() => {});
  }, [summaryRequestId, summaryQuestionId, currentSession.id]);

  useEffect(() => {
    if (!nudgeRequestId || !nudgeMessage) return;
    const rt = runtimeRef.current;
    if (!rt?.thread) return;
    rt.thread.append({
      role: "user",
      content: nudgeMessage,
    });
    rt.thread.startRun(null);
  }, [nudgeRequestId, nudgeMessage]);

  useEffect(() => {
    if (!activeQuestionId) return;
    const prev = lastQuestionIdRef.current;
    if (prev && prev !== activeQuestionId) {
      requestSummary(prev);
    }
    lastQuestionIdRef.current = activeQuestionId;
  }, [activeQuestionId, requestSummary]);

  return (
    <div className="fixed inset-0 h-dvh w-full bg-white dark:bg-zinc-950 flex flex-col min-h-0">
      {/* Main Header */}
      <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-50 pointer-events-none">
        {/* Left: Brand or Empty */}
        <div className="pointer-events-auto" />

        {/* Right: Auth */}
        <div className="pointer-events-auto bg-white/50 dark:bg-black/50 backdrop-blur-sm p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <SignIn />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row pt-12">
        <AssistantRuntimeProvider runtime={runtime}>
          {activeExperience === "lesson" ? (
            <div className="relative flex-1 min-h-0 flex flex-col lg:flex-row">
              {(lessonState?.session?.timerRunning || lessonState?.session?.timerRemainingSec) && (
                <div className="pointer-events-none fixed bottom-4 right-4 z-[60]">
                  <div
                    className={`rounded-full border px-5 py-3 text-xl font-bold shadow-lg ${
                      remainingSeconds <= 10
                        ? "border-red-300 bg-red-100 text-red-700 animate-pulse"
                        : remainingSeconds <= 30
                        ? "border-amber-300 bg-amber-100 text-amber-700 animate-pulse"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    {formatTime(remainingSeconds)}
                  </div>
                </div>
              )}
              {lessonState?.session?.isFrozen && (
                <div className="absolute inset-0 z-50 bg-sky-900/35 backdrop-blur-sm">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-white/10 to-sky-200/10" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-5 py-2 text-base font-semibold text-sky-700 shadow-lg">
                      Frozen
                    </div>
                  </div>
                </div>
              )}
              <div className="relative flex-1 min-w-0 min-h-0 bg-white">
                {lessonState ? (
                  (() => {
                    const rawWidgets: string[] = lessonState.slideResponseConfig?.widgets || (
                      lessonState.slideResponseType === "both"
                        ? ["text", "drawing"]
                        : [lessonState.slideResponseType || "text"]
                    );
                    const widgets = Array.from(new Set([...(rawWidgets || []), "drawing"]));
                    const showDrawing = widgets.includes("drawing");
                    const digits = String(lessonState.lesson.pageCount || 1).length;
                    const slideFilename = `${String(lessonState.currentSlideIndex).padStart(digits, "0")}.png`;
                    const slideCacheKey = lessonState.currentSlideId
                      ? lessonState.currentSlideId
                      : `${lessonState.currentSlideIndex}`;
                      return (
                        <LessonStage
                          lessonId={lessonState.lesson.id}
                          slideFilename={slideFilename}
                          cacheKey={slideCacheKey}
                          currentSlideIndex={lessonState.currentSlideIndex}
                          slideCount={lessonState.lesson.pageCount || lessonState.slides.length || 1}
                          sessionMode={lessonState.session.mode}
                          onChangeSlide={handleLessonSlideChange}
                          showDrawing={showDrawing}
                          readOnly={!!lessonState.session.isFrozen}
                          onDrawingChange={showDrawing ? handleDrawingChange : undefined}
                          sceneData={lessonState.slideResponseConfig?.sceneData}
                          onDrawingTextChange={(text) => {
                            const slideId = lessonState.currentSlideId;
                            if (!slideId) return;
                            setLessonDrawingTextBySlide((prev) => {
                              if ((prev[slideId] || "") === (text || "")) return prev;
                              return { ...prev, [slideId]: text };
                            });
                          }}
                        />
                      );
                  })()
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
                    Loading lesson session...
                  </div>
                )}
              </div>
              <aside
                className={`relative border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 overflow-y-auto transition-all duration-150 min-h-0 ${sidebarOpen ? "block" : "hidden lg:block"} ${sidebarOpen ? "" : "lg:w-0 lg:border-l-0"}`}
                style={sidebarOpen ? { width: Math.max(420, sidebarWidth) } : undefined}
              >
                {sidebarOpen && (
                  <div className="relative h-full">
                    <div
                      className="absolute -left-1 top-0 h-full w-3 cursor-col-resize z-30"
                      onMouseDown={(e) => {
                        const startX = e.clientX;
                        const startWidth = sidebarWidth;

                        const onMove = (ev: MouseEvent) => {
                          const delta = startX - ev.clientX;
                          const next = Math.min(720, Math.max(420, startWidth + delta));
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
                    <div className="flex h-full flex-col p-0">
                      <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-600">
                        <button
                          onClick={() => setLessonTab("chat")}
                          className={`rounded-full px-3 py-1 ${
                            lessonTab === "chat"
                              ? "bg-amber-100 text-amber-700"
                              : "text-zinc-600 hover:bg-zinc-100"
                          }`}
                        >
                          Chat
                        </button>
                        <button
                          onClick={() => setLessonTab("calculator")}
                          className={`rounded-full px-3 py-1 ${
                            lessonTab === "calculator"
                              ? "bg-emerald-100 text-emerald-700"
                              : "text-zinc-600 hover:bg-zinc-100"
                          }`}
                        >
                          Calculator
                        </button>
                      </div>
                      <div className="mt-2 flex-1 min-h-0">
                        <div className={lessonTab === "chat" ? "h-full" : "hidden"}>
                          <div className="flex h-full flex-col gap-2">
                            {lessonState &&
                              (() => {
                                const responseType = lessonState.slideResponseType || "text";
                                const widgets = lessonState.slideResponseConfig?.widgets || (
                                  responseType === "both"
                                    ? ["text", "drawing"]
                                    : [responseType || "text"]
                                );
                                if (!widgets.includes("choice")) return null;
                                const choices = lessonState.slideResponseConfig?.choices || [];
                                const multi = !!lessonState.slideResponseConfig?.multi;
                                const explain = !!lessonState.slideResponseConfig?.explain;
                                const disabled = !!lessonState.session?.isFrozen;
                                if (!lessonState.currentSlideId || !lessonState.session?.id) return null;
                                return (
                                  <LessonChoiceWidget
                                    choices={choices}
                                    multi={multi}
                                    value={lessonChoiceValue}
                                    explain={explain}
                                    explainValue={lessonChoiceExplain}
                                    onExplainChange={setLessonChoiceExplain}
                                    saving={lessonResponseSaving}
                                    onChange={setLessonChoiceValue}
                                    disabled={disabled}
                                    onSubmit={() =>
                                      saveLessonResponse(
                                        lessonState.session.id,
                                        lessonState.currentSlideId!,
                                        responseType,
                                        explain
                                          ? JSON.stringify({
                                              selection: multi
                                                ? (() => {
                                                    try {
                                                      const parsed = JSON.parse(lessonChoiceValue);
                                                      return Array.isArray(parsed) ? parsed : [];
                                                    } catch {
                                                      return [];
                                                    }
                                                  })()
                                                : lessonChoiceValue,
                                              explain: lessonChoiceExplain || "",
                                            })
                                          : lessonChoiceValue
                                      )
                                    }
                                  />
                                );
                              })()}
                            <div className="flex-1 min-h-0">
                              <Thread />
                            </div>
                          </div>
                        </div>
                        <div
                          className={
                            lessonTab === "calculator"
                              ? "flex h-full flex-col rounded-xl border border-zinc-200 bg-white"
                              : "hidden"
                          }
                        >
                          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200">
                            <span className="text-xs font-semibold uppercase text-zinc-500">Desmos Calculator</span>
                            <button
                              onClick={() => setCalcLarge((v) => !v)}
                              className="text-[11px] text-zinc-500 hover:text-zinc-700"
                            >
                              {calcLarge ? "Compact" : "Large"}
                            </button>
                          </div>
                          <iframe
                            src="https://www.desmos.com/testing/texas/graphing"
                            className="w-full flex-1 border-none"
                            title="Desmos Calculator"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0 min-h-0">
                <Thread />
              </div>
              <aside
                className={`border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 overflow-y-auto transition-all duration-150 min-h-0 ${sidebarOpen ? "block" : "hidden lg:block"} ${sidebarOpen ? "" : "lg:w-0 lg:border-l-0"}`}
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
            </>
          )}
        </AssistantRuntimeProvider>
      </div>

      {/* Teacher Mode Toggle */}
      <Link href="/teacher" className="fixed bottom-4 left-4 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-full shadow-lg hover:scale-110 transition-transform text-zinc-500 hover:text-indigo-600 z-50">
        <Link2 className="w-5 h-5" />
      </Link>

      {/* Calculator is now a sidebar tab */}
    </div>
  );
}
