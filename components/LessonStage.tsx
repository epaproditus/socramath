"use client";

import LessonExcalidrawOverlay from "@/components/LessonExcalidrawOverlay";
import { ChevronLeft, ChevronRight } from "lucide-react";

type LessonStageProps = {
  lessonId: string;
  slideFilename: string;
  cacheKey?: string;
  currentSlideIndex: number;
  slideCount: number;
  sessionMode: "instructor" | "student";
  onChangeSlide: (nextIndex: number) => void;
  showDrawing: boolean;
  onDrawingChange?: (dataUrl: string) => void;
  onDrawingTextChange?: (text: string) => void;
  readOnly?: boolean;
  sceneData?: {
    snapshot?: Record<string, unknown>;
    elements?: unknown[];
    files?: Record<string, unknown>;
    appState?: Record<string, unknown>;
  };
};

export default function LessonStage({
  lessonId,
  slideFilename,
  cacheKey,
  currentSlideIndex,
  slideCount,
  sessionMode,
  onChangeSlide,
  showDrawing,
  onDrawingChange,
  onDrawingTextChange,
  readOnly,
  sceneData,
}: LessonStageProps) {
  const cacheParam = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  const slideImageUrl = `/uploads/lessons/${lessonId}/slides/${slideFilename}${cacheParam}`;
  return (
    <div
      className="flex h-full w-full items-start justify-center p-4 overflow-y-auto"
      data-lesson-scroll
    >
      <div className="relative w-full max-w-[1400px] pt-14 pb-4">
        {showDrawing ? (
          <LessonExcalidrawOverlay
            imageUrl={slideImageUrl}
            onChange={onDrawingChange}
            onTextChange={onDrawingTextChange}
            sceneData={sceneData}
            readOnly={readOnly}
          />
        ) : (
          <img
            src={slideImageUrl}
            alt={`Slide ${currentSlideIndex}`}
            className="w-full h-auto rounded-xl border border-zinc-200 object-contain bg-zinc-50"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.dataset.fallbackApplied === "1") return;
              target.dataset.fallbackApplied = "1";
              target.src = `/uploads/lessons/${lessonId}/slides/${currentSlideIndex}.png${cacheParam}`;
            }}
          />
        )}
        {readOnly && (
          <div className="absolute inset-0 z-10 rounded-xl bg-zinc-900/25 backdrop-blur-[1px]" />
        )}
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center justify-end">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-2 py-1 shadow-sm">
            <button
              onClick={() => onChangeSlide(currentSlideIndex - 1)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs"
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <span className="text-[11px] text-zinc-500">
              Slide {currentSlideIndex} of {slideCount}
            </span>
            <button
              onClick={() => onChangeSlide(currentSlideIndex + 1)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
