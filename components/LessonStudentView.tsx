"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquareText, Presentation } from "lucide-react";
import { Assistant } from "@/app/assistant";
import { getRealtimeSocket } from "@/lib/realtime-client";

type Slide = { id: string; index: number };
type LessonState = {
  lesson: { id: string; title: string; pdfPath?: string | null; pageCount: number };
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
  slides: Slide[];
};

export default function LessonStudentView() {
  const [state, setState] = useState<LessonState | null>(null);
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"chat" | "slide">("chat");
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const prevFrozenRef = useRef(false);
  const responseSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const slideCount = state?.lesson.pageCount || state?.slides.length || 1;
  const currentSlideIndex = state?.currentSlideIndex || 1;
  const remainingSeconds = useMemo(() => {
    if (!state?.session) return 0;
    if (state.session.timerRunning && state.session.timerEndsAt) {
      const end = new Date(state.session.timerEndsAt).getTime();
      return Math.max(0, Math.floor((end - timerNow) / 1000));
    }
    if (typeof state.session.timerRemainingSec === "number") {
      return Math.max(0, state.session.timerRemainingSec);
    }
    return 0;
  }, [state?.session, timerNow]);

  const formatTime = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const currentSlideId = useMemo(() => {
    const slide = state?.slides.find((s) => s.index === currentSlideIndex);
    return slide?.id || null;
  }, [state?.slides, currentSlideIndex]);
  const currentSlideCacheKey = useMemo(() => {
    const slide = state?.slides.find((s) => s.index === currentSlideIndex);
    if (!slide) return String(currentSlideIndex);
    return slide.id;
  }, [state?.slides, currentSlideIndex]);

  const slideFilename = useMemo(() => {
    const digits = String(slideCount).length;
    return `${String(currentSlideIndex).padStart(digits, "0")}.png`;
  }, [currentSlideIndex, slideCount]);

  const allowedSlides = useMemo(() => {
    const allowed = state?.session?.paceConfig?.allowedSlides;
    if (!Array.isArray(allowed) || !allowed.length) return null;
    return Array.from(new Set(allowed)).filter((idx) => typeof idx === "number").sort((a, b) => a - b);
  }, [state?.session?.paceConfig]);

  const nextAllowed = useMemo(() => {
    if (!allowedSlides?.length) return null;
    return allowedSlides.find((idx) => idx > currentSlideIndex) ?? null;
  }, [allowedSlides, currentSlideIndex]);

  const prevAllowed = useMemo(() => {
    if (!allowedSlides?.length) return null;
    return [...allowedSlides].reverse().find((idx) => idx < currentSlideIndex) ?? null;
  }, [allowedSlides, currentSlideIndex]);

  const loadState = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lesson-state");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setState(json);
    } catch {
      // ignore for now
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("lesson-view-mode");
    if (stored === "chat" || stored === "slide") setViewMode(stored);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("lesson-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!state?.lesson?.id || !state?.session?.id) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    socket.emit("join", { lessonId: state.lesson.id, sessionId: state.session.id });
    const handleUpdate = (payload: { lessonId?: string; sessionId?: string }) => {
      if (payload.sessionId && payload.sessionId !== state.session.id) return;
      if (payload.lessonId && payload.lessonId !== state.lesson.id) return;
      loadState();
    };
    socket.on("lesson:update", handleUpdate);
    return () => {
      socket.off("lesson:update", handleUpdate);
    };
  }, [state?.lesson?.id, state?.session?.id]);

  useEffect(() => {
    if (!state) return;
    const shouldPoll =
      state.session.mode === "instructor" ||
      !!state.session.timerRunning ||
      !!state.session.isFrozen;
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      loadState();
    }, 2000);
    return () => clearInterval(interval);
  }, [state?.session.mode, state?.session.timerRunning, state?.session.isFrozen]);

  useEffect(() => {
    if (!state?.session?.timerRunning) return;
    const interval = setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [state?.session?.timerRunning, state?.session?.timerEndsAt]);

  useEffect(() => {
    if (!state?.session?.id) return;
    if (state.session.mode !== "student") return;
    const interval = setInterval(() => {
      fetch("/api/lesson-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.session.id,
          currentSlideIndex,
        }),
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [state?.session?.id, state?.session?.mode, currentSlideIndex]);

  useEffect(() => {
    const isFrozen = !!state?.session?.isFrozen;
    if (!prevFrozenRef.current && isFrozen) {
      try {
        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const audioCtx = new AudioCtx();
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
  }, [state?.session?.isFrozen]);

  const updateStudentSlide = async (index: number) => {
    if (!state) return;
    let targetIndex = index;
    if (allowedSlides && allowedSlides.length && !allowedSlides.includes(index)) {
      const direction = index > currentSlideIndex ? 1 : -1;
      targetIndex = direction > 0 ? nextAllowed ?? currentSlideIndex : prevAllowed ?? currentSlideIndex;
      if (targetIndex === currentSlideIndex) return;
    }
    const clamped = Math.max(1, Math.min(targetIndex, slideCount));
    setState({ ...state, currentSlideIndex: clamped });
    const res = await fetch("/api/lesson-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.session.id, currentSlideIndex: clamped }),
    });
    if (!res.ok) {
      await loadState();
    }
  };

  const submitResponse = async () => {
    if (!state?.session.id || !currentSlideId) return;
    setSaving(true);
    setSaveMessage(null);
    await fetch("/api/lesson-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.session.id,
        slideId: currentSlideId,
        response: responseText,
      }),
    });
    setSaving(false);
    setSaveMessage("Response saved.");
    setTimeout(() => setSaveMessage(null), 2000);
  };

  useEffect(() => {
    if (!state?.session.id || !currentSlideId) return;
    if (!responseText.trim()) return;
    if (responseSaveTimerRef.current) clearTimeout(responseSaveTimerRef.current);
    responseSaveTimerRef.current = setTimeout(async () => {
      await fetch("/api/lesson-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.session.id,
          slideId: currentSlideId,
          response: responseText,
        }),
      }).catch(() => {});
    }, 700);
    return () => {
      if (responseSaveTimerRef.current) clearTimeout(responseSaveTimerRef.current);
    };
  }, [responseText, state?.session.id, currentSlideId]);

  if (!state && !loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
          No active lesson session yet. Ask your teacher to start a live session.
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full">
      <div className="flex h-full flex-col relative">
        {state?.session?.isFrozen && (
          <div className="absolute inset-0 z-40 bg-sky-900/35 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-white/10 to-sky-200/10" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-5 py-2 text-base font-semibold text-sky-700 shadow-lg">
                Frozen
              </div>
            </div>
          </div>
        )}
        {(state?.session.timerRunning || state?.session.timerRemainingSec) && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-50">
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
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Lesson</div>
            <div className="text-sm font-semibold">{state?.lesson.title || "Lesson"}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("chat")}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                viewMode === "chat"
                  ? "bg-indigo-100 text-indigo-700"
                  : "border border-zinc-200 text-zinc-600"
              }`}
            >
              <MessageSquareText className="h-3.5 w-3.5" /> Chat-first
            </button>
            <button
              onClick={() => setViewMode("slide")}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                viewMode === "slide"
                  ? "bg-amber-100 text-amber-700"
                  : "border border-zinc-200 text-zinc-600"
              }`}
            >
              <Presentation className="h-3.5 w-3.5" /> Slide-first
            </button>
          </div>
        </div>

        <div className={`flex h-full flex-1 ${viewMode === "slide" ? "flex-col lg:flex-row-reverse" : "flex-col lg:flex-row"}`}>
          <div className="flex h-full flex-1 flex-col border-r border-zinc-200">
            <div className="flex-1 overflow-auto">
              <Assistant />
            </div>
          </div>

          <div className="relative flex w-full flex-col border-t border-zinc-200 lg:w-[420px] lg:border-t-0">
            <div className="relative flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-sm">
              <div>
                Slide {currentSlideIndex} of {slideCount}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    state?.session.mode === "student" && updateStudentSlide(currentSlideIndex - 1)
                  }
                  disabled={
                    state?.session.mode !== "student" ||
                    (allowedSlides && prevAllowed === null)
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs disabled:opacity-40"
                >
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <button
                  onClick={() =>
                    state?.session.mode === "student" && updateStudentSlide(currentSlideIndex + 1)
                  }
                  disabled={
                    state?.session.mode !== "student" ||
                    (allowedSlides && nextAllowed === null)
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {state?.lesson.id ? (
                <div className="relative">
                  <img
                    src={`/uploads/lessons/${state.lesson.id}/slides/${slideFilename}?v=${encodeURIComponent(
                      currentSlideCacheKey
                    )}`}
                    alt={`Slide ${currentSlideIndex}`}
                    className="h-[420px] w-full rounded-lg border border-zinc-200 object-contain bg-zinc-50"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.dataset.fallbackApplied === "1") return;
                      target.dataset.fallbackApplied = "1";
                      target.src = `/uploads/lessons/${state.lesson.id}/slides/${currentSlideIndex}.png?v=${encodeURIComponent(
                        currentSlideCacheKey
                      )}`;
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                  No PDF available.
                </div>
              )}

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium">
                  Your Response (Slide {currentSlideIndex})
                </label>
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  className="h-28 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  placeholder="Type your response..."
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-zinc-500">
                    {state?.session.mode === "instructor"
                      ? "Instructor-paced: slide is controlled by the teacher."
                      : "Student-paced: you can move at your own pace."}
                  </div>
                  <button
                    onClick={submitResponse}
                    disabled={saving || !responseText.trim()}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {saving ? "Saving..." : "Submit"}
                  </button>
                </div>
                {saveMessage && <div className="mt-2 text-xs text-emerald-600">{saveMessage}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
