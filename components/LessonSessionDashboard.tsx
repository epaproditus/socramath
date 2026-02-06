"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";

type Slide = { id: string; index: number };
type LessonSessionPayload = {
  lesson: { id: string; title: string; pdfPath?: string | null; pageCount: number };
  session: { id: string; mode: "instructor" | "student"; currentSlideIndex: number };
  slides: Slide[];
};

type ResponseRow = {
  id: string;
  response: string;
  user: { id: string; name?: string | null; email?: string | null; classPeriod?: string | null };
  updatedAt: string;
};

export default function LessonSessionDashboard() {
  const [data, setData] = useState<LessonSessionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentSlideIndex = data?.session.currentSlideIndex || 1;
  const slideCount = data?.lesson.pageCount || data?.slides.length || 1;

  const currentSlideId = useMemo(() => {
    const slide = data?.slides.find((s) => s.index === currentSlideIndex);
    return slide?.id || null;
  }, [data?.slides, currentSlideIndex]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson-session");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load lesson session");
    } finally {
      setLoading(false);
    }
  };

  const loadResponses = async (slideId: string | null, sessionId?: string) => {
    if (!slideId || !sessionId) return;
    setResponsesLoading(true);
    try {
      const res = await fetch(`/api/lesson-response?slideId=${slideId}&sessionId=${sessionId}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setResponses(json || []);
    } catch (err) {
      setResponses([]);
    } finally {
      setResponsesLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (currentSlideId && data?.session.id) {
      loadResponses(currentSlideId, data.session.id);
    }
  }, [currentSlideId, data?.session.id]);

  const updateSession = async (updates: Partial<LessonSessionPayload["session"]>) => {
    if (!data?.session.id) return;
    await fetch("/api/lesson-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: data.session.id, ...updates }),
    });
    await loadData();
  };

  const goToSlide = async (index: number) => {
    const clamped = Math.max(1, Math.min(index, slideCount));
    await updateSession({ currentSlideIndex: clamped });
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm text-zinc-500">Lesson Session</div>
          <h1 className="text-2xl font-semibold">{data?.lesson.title || "Lesson"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/teacher"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Hub
          </Link>
          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
          Loading lesson session...
        </div>
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-zinc-700">Slides</div>
            <div className="space-y-2">
              {data.slides.map((slide) => (
                <button
                  key={slide.id}
                  onClick={() => goToSlide(slide.index)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    slide.index === currentSlideIndex
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  Slide {slide.index}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-700">
                  Slide {currentSlideIndex} of {slideCount}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goToSlide(currentSlideIndex - 1)}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                  <button
                    onClick={() => goToSlide(currentSlideIndex + 1)}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2 text-sm">
                <span className="text-zinc-500">Pacing:</span>
                <button
                  onClick={() => updateSession({ mode: "instructor" })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    data.session.mode === "instructor"
                      ? "bg-emerald-100 text-emerald-700"
                      : "border border-zinc-200 text-zinc-600"
                  }`}
                >
                  Instructor-paced
                </button>
                <button
                  onClick={() => updateSession({ mode: "student" })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    data.session.mode === "student"
                      ? "bg-amber-100 text-amber-700"
                      : "border border-zinc-200 text-zinc-600"
                  }`}
                >
                  Student-paced
                </button>
              </div>

              {data.lesson.pdfPath ? (
                <iframe
                  src={`${data.lesson.pdfPath}#page=${currentSlideIndex}&view=FitH`}
                  className="h-[520px] w-full rounded-lg border border-zinc-200"
                />
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
                  No PDF uploaded for this lesson.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-700">
                Student Responses (Slide {currentSlideIndex})
              </div>
              {responsesLoading && (
                <div className="text-sm text-zinc-500">Loading responses...</div>
              )}
              {!responsesLoading && responses.length === 0 && (
                <div className="text-sm text-zinc-500">No responses yet.</div>
              )}
              <div className="space-y-3">
                {responses.map((r) => (
                  <div key={r.id} className="rounded-lg border border-zinc-200 p-3">
                    <div className="text-xs text-zinc-500">
                      {r.user.name || r.user.email || "Student"}{" "}
                      {r.user.classPeriod ? `• Period ${r.user.classPeriod}` : ""}
                    </div>
                    <div className="mt-1 text-sm">{r.response}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
