"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import RichTextEditor from "@/components/RichTextEditor";
import LessonExcalidrawOverlay from "@/components/LessonExcalidrawOverlay";

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

export default function LessonSessionDashboard() {
  const [data, setData] = useState<LessonSessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slideDetail, setSlideDetail] = useState<SlideDetail | null>(null);
  const [slideSaving, setSlideSaving] = useState(false);
  const [slideMessage, setSlideMessage] = useState<string | null>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sceneSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const scratchTextTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [creatingSlide, setCreatingSlide] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const overlayRef = useRef<{ runOcr: () => Promise<void> } | null>(null);

  const currentSlideIndex = data?.session.currentSlideIndex || 1;
  const slideCount = data?.lesson.pageCount || data?.slides.length || 1;

  const currentSlideId = useMemo(() => {
    const slide = data?.slides.find((s) => s.index === currentSlideIndex);
    return slide?.id || null;
  }, [data?.slides, currentSlideIndex]);
  const currentSlideCacheKey = useMemo(() => {
    const slide = data?.slides.find((s) => s.index === currentSlideIndex);
    if (!slide) return String(currentSlideIndex);
    return slide.id;
  }, [data?.slides, currentSlideIndex]);

  const slideFilename = useMemo(() => {
    const digits = String(slideCount).length;
    return `${String(currentSlideIndex).padStart(digits, "0")}.png`;
  }, [currentSlideIndex, slideCount]);

  const loadData = async () => {
    setError(null);
    try {
      const res = await fetch("/api/lesson-session");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load lesson session");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!currentSlideId || !data?.session.id) return;
    return () => {};
  }, [currentSlideId, data?.session.id]);

  useEffect(() => {
    const loadSlide = async () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (sceneSaveTimerRef.current) clearTimeout(sceneSaveTimerRef.current);
      if (scratchTextTimerRef.current) clearTimeout(scratchTextTimerRef.current);
      if (!currentSlideId) {
        setSlideDetail(null);
        return;
      }
      setSlideDetail(null);
      const res = await fetch(`/api/lesson-slide?slideId=${currentSlideId}`);
      if (!res.ok) {
        setSlideDetail(null);
        return;
      }
      const json = await res.json();
      setSlideDetail({
        ...json,
      });
      const rubricHtml = Array.isArray(json.rubric) ? json.rubric.join("\n") : "";
      lastSavedRef.current = JSON.stringify({
        id: json.id,
        prompt: json.prompt || "",
        rubric: rubricHtml,
      });
      hydratedRef.current = true;
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
    const res = await fetch("/api/lesson-slide", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slideId: slideDetail.id,
        prompt: slideDetail.prompt,
        rubric: slideDetail.rubric,
      }),
    });
    if (!res.ok) {
      setSlideSaving(false);
      setSlideMessage("Slide changed, reloading...");
      await loadData();
      return;
    }
    setSlideSaving(false);
    setSlideMessage("Saved.");
    setTimeout(() => setSlideMessage(null), 1200);
    lastSavedRef.current = JSON.stringify({
      id: slideDetail.id,
      prompt: slideDetail.prompt || "",
      rubric: Array.isArray(slideDetail.rubric) ? slideDetail.rubric.join("\n") : "",
    });
  };

  const scheduleAutosave = () => {
    if (!slideDetail) return;
    if (!hydratedRef.current) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      const snapshot = JSON.stringify({
        id: slideDetail.id,
        prompt: slideDetail.prompt || "",
        rubric: Array.isArray(slideDetail.rubric) ? slideDetail.rubric.join("\n") : "",
      });
      if (snapshot !== lastSavedRef.current) {
        saveSlideDetail();
      }
    }, 600);
  };

  const createScratchSlide = async () => {
    if (!data?.lesson.id) return;
    setCreatingSlide(true);
    try {
      const res = await fetch("/api/lesson-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: data.lesson.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      await updateSession({ currentSlideIndex: created.index });
    } catch (err: any) {
      setError(err?.message || "Failed to create slide");
    } finally {
      setCreatingSlide(false);
    }
  };

  const deleteScratchSlide = async () => {
    if (!slideDetail?.id || !data?.session.id) return;
    if (!confirm("Delete this slide?")) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    if (sceneSaveTimerRef.current) clearTimeout(sceneSaveTimerRef.current);
    if (scratchTextTimerRef.current) clearTimeout(scratchTextTimerRef.current);
    const deletingId = slideDetail.id;
    setSlideDetail(null);
    await fetch("/api/lesson-slide", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slideId: deletingId }),
    });
    const nextIndex = Math.max(1, Math.min(currentSlideIndex, slideCount - 1));
    await updateSession({ currentSlideIndex: nextIndex });
  };

  const handleSceneChange = (sceneData: {
    elements: unknown[];
    files: Record<string, unknown>;
    appState: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
  }) => {
    if (!slideDetail?.id) return;
    const targetSlideId = slideDetail.id;
    if (sceneSaveTimerRef.current) clearTimeout(sceneSaveTimerRef.current);
    sceneSaveTimerRef.current = setTimeout(async () => {
      const res = await fetch("/api/lesson-slide", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId: targetSlideId, sceneData }),
      });
      if (res.status === 404) {
        await loadData();
      }
    }, 700);
  };

  const handleScratchTextChange = (text: string) => {
    if (!slideDetail?.id) return;
    const targetSlideId = slideDetail.id;
    if (scratchTextTimerRef.current) clearTimeout(scratchTextTimerRef.current);
    scratchTextTimerRef.current = setTimeout(async () => {
      const res = await fetch("/api/lesson-slide", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId: targetSlideId, text }),
      });
      if (res.status === 404) {
        await loadData();
      }
    }, 700);
  };

  const runOcrScan = async () => {
    if (!overlayRef.current || ocrRunning) return;
    setOcrRunning(true);
    try {
      await overlayRef.current.runOcr();
    } finally {
      setOcrRunning(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] p-3">
      <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-3 py-2">
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
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px] min-h-[calc(100vh-140px)]">
          <aside className="rounded-2xl border border-zinc-200 bg-white p-2 h-full flex flex-col">
            <button
              onClick={createScratchSlide}
              disabled={creatingSlide}
              className="mb-2 w-full rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            >
              {creatingSlide ? "Creating..." : "+ New slide"}
            </button>
            <div className="space-y-2 overflow-y-auto flex-1 pr-1">
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
                    <span className="mb-1 block text-[11px] text-zinc-500">#{slide.index}</span>
                    <img
                      src={`/uploads/lessons/${data.lesson.id}/slides/${thumbFilename}?v=${encodeURIComponent(
                        slide.id
                      )}`}
                      alt={`Slide ${slide.index}`}
                      className="aspect-[3/4] w-full rounded-lg border border-zinc-200 object-contain bg-white"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.dataset.fallbackApplied === "1") return;
                        target.dataset.fallbackApplied = "1";
                        target.src = `/uploads/lessons/${data.lesson.id}/slides/${slide.index}.png?v=${encodeURIComponent(
                          slide.id
                        )}`;
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-700">
                  Slide {currentSlideIndex} of {slideCount}
                </div>
                <div className="flex items-center gap-2">
                  {!slideDetail?.responseConfig?.scratch ? (
                    <button
                      onClick={async () => {
                        if (!slideDetail?.id) return;
                        await fetch("/api/lesson-slide", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            slideId: slideDetail.id,
                            responseConfig: { scratch: true },
                          }),
                        });
                        await loadData();
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
                    >
                      Edit this slide
                    </button>
                  ) : null}
                  {slideCount > 1 && (
                    <button
                      onClick={deleteScratchSlide}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700"
                    >
                      Delete slide
                    </button>
                  )}
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

              {data.lesson.id ? (
                <div className="w-full rounded-lg border border-zinc-200 bg-zinc-50">
                  {slideDetail?.responseConfig?.scratch ? (
                    <LessonExcalidrawOverlay
                      ref={overlayRef}
                      imageUrl={`/uploads/lessons/${data.lesson.id}/slides/${slideFilename}?v=${encodeURIComponent(
                        currentSlideCacheKey
                      )}`}
                      onTextChange={handleScratchTextChange}
                      onOcrText={handleScratchTextChange}
                      sceneData={(slideDetail.responseConfig?.sceneData || undefined) as {
                        elements?: unknown[];
                        files?: Record<string, unknown>;
                        appState?: Record<string, unknown>;
                      }}
                      onSceneChange={handleSceneChange}
                    />
                  ) : (
                    <img
                      src={`/uploads/lessons/${data.lesson.id}/slides/${slideFilename}?v=${encodeURIComponent(
                        currentSlideCacheKey
                      )}`}
                      alt={`Slide ${currentSlideIndex}`}
                      className="h-auto w-full object-contain bg-white"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.dataset.fallbackApplied === "1") return;
                        target.dataset.fallbackApplied = "1";
                        target.src = `/uploads/lessons/${data.lesson.id}/slides/${currentSlideIndex}.png?v=${encodeURIComponent(
                          currentSlideCacheKey
                        )}`;
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
                  No PDF uploaded for this lesson.
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-zinc-200 bg-white p-3 h-full">
            <div className="mb-3 text-xs font-semibold uppercase text-zinc-500">Rubric</div>
            {!slideDetail && (
              <div className="text-sm text-zinc-500">Select a slide to edit.</div>
            )}
            {slideDetail && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                    Prompt
                  </label>
                  <RichTextEditor
                    value={slideDetail.prompt || ""}
                    placeholder="What should students think about on this slide?"
                    onChange={(value) => {
                      setSlideDetail({ ...slideDetail, prompt: value });
                      scheduleAutosave();
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                    Rubric (one per line)
                  </label>
                  <RichTextEditor
                    value={(slideDetail.rubric || []).join("\n") || ""}
                    placeholder="e.g. Uses a^2 + b^2 = c^2"
                    onChange={(value) => {
                      const rubric = value.trim() ? [value] : [];
                      setSlideDetail({ ...slideDetail, rubric });
                      scheduleAutosave();
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{slideSaving ? "Saving..." : slideMessage || "Autosave on edit"}</span>
                  <button
                    type="button"
                    onClick={runOcrScan}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                    disabled={ocrRunning}
                  >
                    {ocrRunning ? "Scanning..." : "Scan text"}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
