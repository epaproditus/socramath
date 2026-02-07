"use client";

import LessonExcalidrawOverlay from "@/components/LessonExcalidrawOverlay";

type LessonStageProps = {
  lessonId: string;
  slideFilename: string;
  currentSlideIndex: number;
  showDrawing: boolean;
  onDrawingChange?: (dataUrl: string) => void;
};

export default function LessonStage({
  lessonId,
  slideFilename,
  currentSlideIndex,
  showDrawing,
  onDrawingChange,
}: LessonStageProps) {
  const slideImageUrl = `/uploads/lessons/${lessonId}/slides/${slideFilename}`;
  return (
    <div
      className="flex h-full w-full items-start justify-center p-4 overflow-y-auto"
      data-lesson-scroll
    >
      <div className="relative w-full max-w-[1400px]">
        {showDrawing ? (
          <LessonExcalidrawOverlay imageUrl={slideImageUrl} onChange={onDrawingChange} />
        ) : (
          <img
            src={slideImageUrl}
            alt={`Slide ${currentSlideIndex}`}
            className="w-full h-auto rounded-xl border border-zinc-200 object-contain bg-zinc-50"
            onError={(e) => {
              const target = e.currentTarget;
              const fallback = `/uploads/lessons/${lessonId}/slides/${currentSlideIndex}.png`;
              if (target.src.endsWith(slideFilename)) {
                target.src = fallback;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
