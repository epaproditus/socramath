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

type SlideDetail = {
  id: string;
  index: number;
  text: string;
  prompt: string;
  rubric: string[];
  responseType: string;
  responseConfig: Record<string, any>;
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
  const [slideDetail, setSlideDetail] = useState<SlideDetail | null>(null);
  const [slideSaving, setSlideSaving] = useState(false);
  const [slideMessage, setSlideMessage] = useState<string | null>(null);

  const currentSlideIndex = data?.session.currentSlideIndex || 1;
  const slideCount = data?.lesson.pageCount || data?.slides.length || 1;

  const currentSlideId = useMemo(() => {
    const slide = data?.slides.find((s) => s.index === currentSlideIndex);
    return slide?.id || null;
  }, [data?.slides, currentSlideIndex]);

  const slideFilename = useMemo(() => {
    const digits = String(slideCount).length;
    return `${String(currentSlideIndex).padStart(digits, "0")}.png`;
  }, [currentSlideIndex, slideCount]);

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
    if (!currentSlideId || !data?.session.id) return;
    loadResponses(currentSlideId, data.session.id);
    const interval = setInterval(() => {
      loadResponses(currentSlideId, data.session.id);
    }, 2000);
    return () => clearInterval(interval);
  }, [currentSlideId, data?.session.id]);

  useEffect(() => {
    const loadSlide = async () => {
      if (!currentSlideId) return;
      const res = await fetch(`/api/lesson-slide?slideId=${currentSlideId}`);
      if (!res.ok) return;
      const json = await res.json();
      const widgets = Array.isArray(json.responseConfig?.widgets)
        ? json.responseConfig.widgets
        : json.responseType === "both"
          ? ["text", "drawing"]
          : json.responseType
            ? [json.responseType]
            : ["text"];
      setSlideDetail({
        ...json,
        responseConfig: { ...json.responseConfig, widgets },
      });
    };
    loadSlide();
  }, [currentSlideId]);

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

  const saveSlideDetail = async () => {
    if (!slideDetail) return;
    setSlideSaving(true);
    setSlideMessage(null);
    await fetch("/api/lesson-slide", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slideId: slideDetail.id,
        prompt: slideDetail.prompt,
        rubric: slideDetail.rubric,
        responseType: slideDetail.responseType,
        responseConfig: slideDetail.responseConfig,
      }),
    });
    setSlideSaving(false);
    setSlideMessage("Saved.");
    setTimeout(() => setSlideMessage(null), 1500);
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] p-6">
      <div className="mb-5 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-500">Lesson Session</div>
          <div className="text-base font-semibold text-zinc-900">
            {data?.lesson.title || "Session name"}
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
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            <div className="mb-3 text-xs font-semibold uppercase text-zinc-500">Slides</div>
            <div className="space-y-3 overflow-y-auto max-h-[78vh] pr-1">
              {data.slides.map((slide) => {
                const digits = String(slideCount).length;
                const thumbFilename = `${String(slide.index).padStart(digits, "0")}.png`;
                return (
                  <button
                    key={slide.id}
                    onClick={() => goToSlide(slide.index)}
                    className={`w-full rounded-xl border p-2 text-left ${
                      slide.index === currentSlideIndex
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="text-[11px] text-zinc-500 mb-2">Slide {slide.index}</div>
                    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                      <img
                        src={`/uploads/lessons/${data.lesson.id}/slides/${thumbFilename}`}
                        alt={`Slide ${slide.index}`}
                        className="h-28 w-full object-contain bg-white"
                        onError={(e) => {
                          const target = e.currentTarget;
                          const fallback = `/uploads/lessons/${data.lesson.id}/slides/${slide.index}.png`;
                          if (target.src.endsWith(thumbFilename)) {
                            target.src = fallback;
                          }
                        }}
                      />
                    </div>
                  </button>
                );
              })}
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

              {data.lesson.id ? (
                <img
                  src={`/uploads/lessons/${data.lesson.id}/slides/${slideFilename}`}
                  alt={`Slide ${currentSlideIndex}`}
                  className="h-[70vh] w-full rounded-lg border border-zinc-200 object-contain bg-zinc-50"
                  onError={(e) => {
                    const target = e.currentTarget;
                    const fallback = `/uploads/lessons/${data.lesson.id}/slides/${currentSlideIndex}.png`;
                    if (target.src.endsWith(slideFilename)) {
                      target.src = fallback;
                    }
                  }}
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {responses.map((r) => (
                  <div key={r.id} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                    <div className="text-xs font-semibold text-zinc-700">
                      {r.user.name || r.user.email || "Student"}
                    </div>
                    {r.user.classPeriod && (
                      <div className="text-[11px] text-zinc-500">Period {r.user.classPeriod}</div>
                    )}
                    <div className="mt-2 h-32 rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden flex items-center justify-center">
                      {r.drawingPath ? (
                        <img
                          src={`${r.drawingPath}?t=${new Date(r.updatedAt).getTime()}`}
                          alt="Student drawing"
                          className="h-full w-full object-contain bg-white"
                        />
                      ) : (
                        <div className="text-[11px] text-zinc-400">No drawing</div>
                      )}
                    </div>
                    {r.response && (
                      <div className="mt-2 text-xs text-zinc-700 line-clamp-4">{r.response}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-700">
                Slide Prompt & Rubric
              </div>
              {!slideDetail && (
                <div className="text-sm text-zinc-500">Select a slide to edit.</div>
              )}
              {slideDetail && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                      Response Widgets
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {["text", "geogebra"].map((widget) => {
                        const widgets: string[] = slideDetail.responseConfig?.widgets || [];
                        const enabled = widgets.includes(widget);
                        return (
                          <button
                            key={widget}
                            onClick={() => {
                              const next = enabled
                                ? widgets.filter((w) => w !== widget)
                                : [...widgets, widget];
                              const responseType = next.length === 2 ? "both" : next[0] || "text";
                              setSlideDetail({
                                ...slideDetail,
                                responseType,
                                responseConfig: { ...slideDetail.responseConfig, widgets: next },
                              });
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              enabled
                                ? "bg-indigo-100 text-indigo-700"
                                : "border border-zinc-200 text-zinc-600"
                            }`}
                          >
                            {widget === "text" ? "Text" : "GeoGebra"}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Drawing is always on for students. Choose additional widgets for this slide.
                    </div>
                  </div>
                  {slideDetail.responseConfig?.widgets?.includes("geogebra") && (
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                        GeoGebra Settings
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-zinc-500">Material ID</label>
                        <input
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm"
                          placeholder="e.g. mJQ8h7uF"
                          value={slideDetail.responseConfig?.geogebra?.materialId || ""}
                          onChange={(e) =>
                            setSlideDetail({
                              ...slideDetail,
                              responseConfig: {
                                ...slideDetail.responseConfig,
                                geogebra: {
                                  ...slideDetail.responseConfig?.geogebra,
                                  materialId: e.target.value,
                                },
                              },
                            })
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-zinc-500">Width</label>
                            <input
                              type="number"
                              className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm"
                              value={slideDetail.responseConfig?.geogebra?.width || 640}
                              onChange={(e) =>
                                setSlideDetail({
                                  ...slideDetail,
                                  responseConfig: {
                                    ...slideDetail.responseConfig,
                                    geogebra: {
                                      ...slideDetail.responseConfig?.geogebra,
                                      width: Number(e.target.value),
                                    },
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500">Height</label>
                            <input
                              type="number"
                              className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm"
                              value={slideDetail.responseConfig?.geogebra?.height || 360}
                              onChange={(e) =>
                                setSlideDetail({
                                  ...slideDetail,
                                  responseConfig: {
                                    ...slideDetail.responseConfig,
                                    geogebra: {
                                      ...slideDetail.responseConfig?.geogebra,
                                      height: Number(e.target.value),
                                    },
                                  },
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                      Prompt
                    </label>
                    <textarea
                      value={slideDetail.prompt}
                      onChange={(e) =>
                        setSlideDetail({ ...slideDetail, prompt: e.target.value })
                      }
                      className="h-24 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                      placeholder="What should students think about on this slide?"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                      Rubric (one per line)
                    </label>
                    <textarea
                      value={slideDetail.rubric.join("\n")}
                      onChange={(e) =>
                        setSlideDetail({
                          ...slideDetail,
                          rubric: e.target.value.split("\n").map((r) => r.trim()).filter(Boolean),
                        })
                      }
                      className="h-24 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                      placeholder="e.g. Uses a^2 + b^2 = c^2"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={saveSlideDetail}
                      disabled={slideSaving}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {slideSaving ? "Saving..." : "Save Prompt"}
                    </button>
                    {slideMessage && <div className="text-xs text-emerald-600">{slideMessage}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-zinc-500">Sidepanel Preview</div>
              <div className="text-[11px] text-zinc-400">Student view</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden h-[78vh]">
              <iframe
                title="Student preview"
                src="/"
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
