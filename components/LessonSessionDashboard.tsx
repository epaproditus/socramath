"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import RichTextEditor from "@/components/RichTextEditor";
import LessonExcalidrawOverlay from "@/components/LessonExcalidrawOverlay";
import TeacherHeatmap from "@/components/TeacherHeatmap";
import { FEATURE_FLAGS } from "@/lib/config";
import { LessonPaceConfig, resolveVisibleLessonBlocks } from "@/lib/lesson-pace";
import {
  LessonBlock,
  createDrawingBlock,
  createMcqBlock,
  createPromptBlock,
  createTextBlock,
  normalizeLessonResponseConfig,
  splitChoiceText,
} from "@/lib/lesson-blocks";

type Slide = { id: string; index: number };
type LessonSessionPayload = {
  lesson: { id: string; title: string; pdfPath?: string | null; pageCount: number };
  session: {
    id: string;
    mode: "instructor" | "student";
    currentSlideIndex: number;
    isFrozen?: boolean;
    paceConfig?: LessonPaceConfig | null;
    timerEndsAt?: string | null;
    timerRemainingSec?: number | null;
    timerRunning?: boolean;
  };
  slides: Slide[];
};

type SlideDetail = {
  id: string;
  index: number;
  text: string;
  prompt: string;
  rubric: string[];
  responseType: string;
  responseConfig: Record<string, unknown>;
};

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

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
  const [activeTab, setActiveTab] = useState<"builder" | "heatmap">("builder");
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
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load lesson session"));
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
      const normalizedResponseConfig = normalizeLessonResponseConfig(
        json.responseConfig || {},
        {
          responseType: json.responseType || "text",
          prompt: json.prompt || "",
        }
      );
      setSlideDetail({
        ...json,
        responseConfig: normalizedResponseConfig,
      });
      const rubricHtml = Array.isArray(json.rubric) ? json.rubric.join("\n") : "";
      lastSavedRef.current = JSON.stringify({
        id: json.id,
        prompt: json.prompt || "",
        rubric: rubricHtml,
        responseType: json.responseType || "text",
        responseConfig: normalizedResponseConfig,
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
        responseType: slideDetail.responseType,
        responseConfig: slideDetail.responseConfig,
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
      responseType: slideDetail.responseType || "text",
      responseConfig: slideDetail.responseConfig || {},
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
        responseType: slideDetail.responseType || "text",
        responseConfig: slideDetail.responseConfig || {},
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
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to create slide"));
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
    meta?: { width: number; height: number };
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

  const normalizedSlideConfig = useMemo(() => {
    if (!slideDetail) return null;
    return normalizeLessonResponseConfig(slideDetail.responseConfig, {
      responseType: slideDetail.responseType,
      prompt: slideDetail.prompt,
    });
  }, [slideDetail]);

  const blocks = useMemo(() => {
    return normalizedSlideConfig?.blocks || ([] as LessonBlock[]);
  }, [normalizedSlideConfig]);

  const visibleBlocksForStudents = useMemo(() => {
    if (!slideDetail || !normalizedSlideConfig) return [] as LessonBlock[];
    return resolveVisibleLessonBlocks({
      blocks: normalizedSlideConfig.blocks,
      slideId: slideDetail.id,
      paceConfig: data?.session.paceConfig || null,
      responseConfig: normalizedSlideConfig,
    });
  }, [data?.session.paceConfig, normalizedSlideConfig, slideDetail]);

  const visibleBlockIds = useMemo(
    () => new Set(visibleBlocksForStudents.map((block) => block.id)),
    [visibleBlocksForStudents]
  );

  const hasVisibilityOverride = useMemo(() => {
    if (!slideDetail) return false;
    return Object.prototype.hasOwnProperty.call(
      data?.session.paceConfig?.revealedBlockIdsBySlide || {},
      slideDetail.id
    );
  }, [data?.session.paceConfig?.revealedBlockIdsBySlide, slideDetail]);

  const updateBlocks = (updater: (current: LessonBlock[]) => LessonBlock[]) => {
    if (!slideDetail) return;
    const normalizedConfig = normalizeLessonResponseConfig(slideDetail.responseConfig, {
      responseType: slideDetail.responseType,
      prompt: slideDetail.prompt,
    });
    const nextBlocks = updater(normalizedConfig.blocks);
    const nextConfig = normalizeLessonResponseConfig(
      {
        ...normalizedConfig,
        blocks: nextBlocks,
      },
      {
        responseType: slideDetail.responseType,
        prompt: slideDetail.prompt,
      }
    );
    setSlideDetail({
      ...slideDetail,
      responseConfig: nextConfig,
    });
    scheduleAutosave();
  };

  const addBlock = (type: LessonBlock["type"]) => {
    if (!slideDetail) return;
    const nextIndex = blocks.filter((block) => block.type === type).length + 1;
    if (type === "prompt") {
      updateBlocks((current) => [
        ...current,
        createPromptBlock("Add guidance for this slide.", "Prompt", `prompt_${nextIndex}`),
      ]);
      return;
    }
    if (type === "text") {
      updateBlocks((current) => [
        ...current,
        createTextBlock("Your response", {
          id: `text_${nextIndex}`,
          required: true,
        }),
      ]);
      return;
    }
    if (type === "mcq") {
      updateBlocks((current) => [
        ...current,
        createMcqBlock("Choose your answer", ["Option A", "Option B"], {
          id: `mcq_${nextIndex}`,
          required: true,
          multi: false,
          requireExplain: false,
        }),
      ]);
      return;
    }
    updateBlocks((current) => [
      ...current,
      createDrawingBlock("Show your work", { id: `drawing_${nextIndex}`, required: false }),
    ]);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    updateBlocks((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  const saveVisibleBlockOverride = async (nextVisibleIds: string[]) => {
    if (!data?.session.id || !slideDetail?.id) return;
    const currentPace = data.session.paceConfig || {};
    const nextMap = {
      ...(currentPace.revealedBlockIdsBySlide || {}),
      [slideDetail.id]: Array.from(
        new Set(nextVisibleIds.map((id) => String(id || "").trim()).filter(Boolean))
      ),
    };
    await updateSession({
      paceConfig: {
        ...currentPace,
        revealedBlockIdsBySlide: nextMap,
      },
    });
    setSlideMessage("Student visibility updated.");
    setTimeout(() => setSlideMessage(null), 1200);
  };

  const clearVisibleBlockOverride = async () => {
    if (!data?.session.id || !slideDetail?.id) return;
    const currentPace = data.session.paceConfig || {};
    const nextMap = { ...(currentPace.revealedBlockIdsBySlide || {}) };
    delete nextMap[slideDetail.id];
    await updateSession({
      paceConfig: {
        ...currentPace,
        revealedBlockIdsBySlide: nextMap,
      },
    });
    setSlideMessage("Student visibility reset to defaults.");
    setTimeout(() => setSlideMessage(null), 1200);
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
        <>
          <div className="mb-4 flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-600 w-fit">
            <button
              onClick={() => setActiveTab("builder")}
              className={`rounded-full px-3 py-1 ${
                activeTab === "builder"
                  ? "bg-amber-100 text-amber-700"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              Builder
            </button>
            <button
              onClick={() => setActiveTab("heatmap")}
              className={`rounded-full px-3 py-1 ${
                activeTab === "heatmap"
                  ? "bg-blue-100 text-blue-700"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              Heatmap
            </button>
          </div>

          {activeTab === "heatmap" ? (
            <TeacherHeatmap />
          ) : (
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
                  <LessonExcalidrawOverlay
                    ref={overlayRef}
                    imageUrl={`/uploads/lessons/${data.lesson.id}/slides/${slideFilename}?v=${encodeURIComponent(
                      currentSlideCacheKey
                    )}`}
                    onTextChange={handleScratchTextChange}
                    onOcrText={handleScratchTextChange}
                    sceneData={(slideDetail?.responseConfig?.sceneData || undefined) as {
                      elements?: unknown[];
                      files?: Record<string, unknown>;
                      appState?: Record<string, unknown>;
                    }}
                    onSceneChange={handleSceneChange}
                  />
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
                      const rubric = value
                        .split(/\r?\n/)
                        .map((item) => item.trim())
                        .filter(Boolean);
                      setSlideDetail({ ...slideDetail, rubric });
                      scheduleAutosave();
                    }}
                  />
                </div>
                {FEATURE_FLAGS.lessonBlockEditor && (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                      Block Editor
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => addBlock("prompt")}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        + Prompt
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlock("text")}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        + Text
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlock("mcq")}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        + MCQ
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlock("drawing")}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        + Drawing
                      </button>
                    </div>
                    <div className="mb-3 rounded-md border border-zinc-200 bg-white p-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Student Reveal Control
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void saveVisibleBlockOverride([]);
                          }}
                          className="rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
                        >
                          Prompt only
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void saveVisibleBlockOverride(
                              blocks
                                .filter((block) => block.type !== "prompt")
                                .map((block) => block.id)
                            );
                          }}
                          className="rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
                        >
                          Show all blocks
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void clearVisibleBlockOverride();
                          }}
                          disabled={!hasVisibilityOverride}
                          className="rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                        >
                          Reset default
                        </button>
                      </div>
                      <div className="mt-2 text-[11px] text-zinc-500">
                        {visibleBlocksForStudents.length}/{blocks.length} blocks currently visible to students.
                      </div>
                    </div>
                    <div className="space-y-3">
                      {blocks.map((block, blockIndex) => (
                        <div
                          key={`${block.id}-${blockIndex}`}
                          className="rounded-lg border border-zinc-200 bg-white p-2"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                              {block.type} • {block.id}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => moveBlock(blockIndex, -1)}
                                className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]"
                                disabled={blockIndex === 0}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveBlock(blockIndex, 1)}
                                className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]"
                                disabled={blockIndex === blocks.length - 1}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlocks((current) =>
                                    current.filter((_, idx) => idx !== blockIndex)
                                  )
                                }
                                className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {block.type !== "prompt" && (
                            <label className="mb-2 flex items-center gap-2 text-[11px] text-zinc-600">
                              <input
                                type="checkbox"
                                checked={visibleBlockIds.has(block.id)}
                                onChange={(e) => {
                                  const nextVisible = new Set(
                                    visibleBlocksForStudents
                                      .filter((item) => item.type !== "prompt")
                                      .map((item) => item.id)
                                  );
                                  if (e.target.checked) {
                                    nextVisible.add(block.id);
                                  } else {
                                    nextVisible.delete(block.id);
                                  }
                                  void saveVisibleBlockOverride(Array.from(nextVisible));
                                }}
                              />
                              Visible to students now
                            </label>
                          )}

                          {block.type === "prompt" && (
                            <div className="space-y-2">
                              <input
                                value={block.title || ""}
                                onChange={(e) =>
                                  updateBlocks((current) =>
                                    current.map((item, idx) =>
                                      idx === blockIndex
                                        ? { ...item, title: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                placeholder="Title"
                              />
                              <textarea
                                value={block.content || ""}
                                onChange={(e) =>
                                  updateBlocks((current) =>
                                    current.map((item, idx) =>
                                      idx === blockIndex
                                        ? { ...item, content: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="h-20 w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                placeholder="Prompt content"
                              />
                            </div>
                          )}

                          {(block.type === "text" || block.type === "drawing") && (
                            <div className="space-y-2">
                              <input
                                value={block.label || ""}
                                onChange={(e) =>
                                  updateBlocks((current) =>
                                    current.map((item, idx) =>
                                      idx === blockIndex
                                        ? { ...item, label: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                placeholder="Label"
                              />
                              {block.type === "text" && (
                                <input
                                  value={block.placeholder || ""}
                                  onChange={(e) =>
                                    updateBlocks((current) =>
                                      current.map((item, idx) =>
                                        idx === blockIndex
                                          ? { ...item, placeholder: e.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                  placeholder="Placeholder"
                                />
                              )}
                              <label className="flex items-center gap-2 text-xs text-zinc-600">
                                <input
                                  type="checkbox"
                                  checked={block.required !== false}
                                  onChange={(e) =>
                                    updateBlocks((current) =>
                                      current.map((item, idx) =>
                                        idx === blockIndex
                                          ? item.type === "prompt"
                                            ? item
                                            : { ...item, required: e.target.checked }
                                          : item
                                      )
                                    )
                                  }
                                />
                                Required
                              </label>
                            </div>
                          )}

                          {block.type === "mcq" && (
                            <div className="space-y-2">
                              <input
                                value={block.label || ""}
                                onChange={(e) =>
                                  updateBlocks((current) =>
                                    current.map((item, idx) =>
                                      idx === blockIndex
                                        ? { ...item, label: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                placeholder="Question label"
                              />
                              <textarea
                                value={(block.choices || []).join("\n")}
                                onChange={(e) =>
                                  updateBlocks((current) =>
                                    current.map((item, idx) =>
                                      idx === blockIndex
                                        ? { ...item, choices: splitChoiceText(e.target.value) }
                                        : item
                                    )
                                  )
                                }
                                className="h-20 w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                                placeholder="One choice per line"
                              />
                              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={!!block.multi}
                                    onChange={(e) =>
                                      updateBlocks((current) =>
                                        current.map((item, idx) =>
                                          idx === blockIndex
                                            ? { ...item, multi: e.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                  />
                                  Multi-select
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={!!block.requireExplain}
                                    onChange={(e) =>
                                      updateBlocks((current) =>
                                        current.map((item, idx) =>
                                          idx === blockIndex
                                            ? { ...item, requireExplain: e.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                  />
                                  Require explanation
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={block.required !== false}
                                    onChange={(e) =>
                                      updateBlocks((current) =>
                                        current.map((item, idx) =>
                                          idx === blockIndex
                                            ? item.type === "prompt"
                                              ? item
                                              : { ...item, required: e.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                  />
                                  Required
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {!blocks.length && (
                        <div className="rounded border border-dashed border-zinc-200 p-2 text-xs text-zinc-500">
                          No blocks yet. Add one above.
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
        </>
      )}
    </div>
  );
}
