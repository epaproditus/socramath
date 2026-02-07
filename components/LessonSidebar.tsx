"use client";

import { useEffect, useState } from "react";
import GeoGebraWidget from "@/components/GeoGebraWidget";

type LessonInfo = {
  id: string;
  title: string;
  pageCount: number;
};

type SessionInfo = {
  id: string;
  mode: "instructor" | "student";
};

type LessonSidebarProps = {
  lesson: LessonInfo;
  session: SessionInfo;
  currentSlideIndex: number;
  currentSlideId: string | null;
  responseType: string;
  responseConfig?: Record<string, any>;
  responseText: string;
  onResponseTextChange: (next: string) => void;
  onAutoSaveResponse: (text: string) => void;
  onSubmitResponse: (response: string) => Promise<void>;
  onSaveDrawing: () => Promise<void>;
};

export default function LessonSidebar({
  lesson,
  session,
  currentSlideIndex,
  currentSlideId,
  responseType,
  responseConfig,
  responseText,
  onResponseTextChange,
  onAutoSaveResponse,
  onSubmitResponse,
  onSaveDrawing,
}: LessonSidebarProps) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const slideCount = lesson.pageCount || 1;
  const submit = async () => {
    if (!currentSlideId || !responseText.trim()) return;
    setSaving(true);
    setSaveMessage(null);
    await onSubmitResponse(responseText);
    setSaving(false);
    setSaveMessage("Response saved.");
    setTimeout(() => setSaveMessage(null), 1500);
  };

  useEffect(() => {
    if (!currentSlideId) return;
    if (!responseText.trim()) return;
    const timer = setTimeout(() => {
      onAutoSaveResponse(responseText);
    }, 700);
    return () => clearTimeout(timer);
  }, [responseText, currentSlideId, onAutoSaveResponse]);

  const submitDrawing = async () => {
    if (!currentSlideId) return;
    setSaving(true);
    setSaveMessage(null);
    await onSaveDrawing();
    setSaving(false);
    setSaveMessage("Drawing saved.");
    setTimeout(() => setSaveMessage(null), 1500);
  };

  const widgets: string[] = responseConfig?.widgets || (
    responseType === "both" ? ["text", "drawing"] : [responseType]
  );
  const showDrawing = widgets.includes("drawing");
  const showText = widgets.includes("text");
  const showGeoGebra = widgets.includes("geogebra");

  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">Lesson</div>
      <div className="text-sm font-semibold">{lesson.title}</div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Lesson</span>
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] uppercase">
            {session.mode === "instructor" ? "Instructor-paced" : "Student-paced"}
          </span>
        </div>
      </div>

      {showText && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Your Response
          </div>
          <textarea
            value={responseText}
            onChange={(e) => onResponseTextChange(e.target.value)}
            className="h-28 w-full rounded-md border border-zinc-200 px-2 py-2 text-sm outline-none focus:border-zinc-400"
            placeholder="Type your response for this slide..."
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[11px] text-zinc-500">
              {session.mode === "instructor"
                ? "Teacher controls the slide."
                : "You can move at your own pace."}
            </div>
            <button
              onClick={submit}
              disabled={saving || !responseText.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving..." : "Submit"}
            </button>
          </div>
          {saveMessage && <div className="mt-2 text-xs text-emerald-600">{saveMessage}</div>}
        </div>
      )}

      {showDrawing && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Draw On Slide
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[11px] text-zinc-500">
              Click the round ✎ button on the slide to start drawing.
            </div>
            <button
              onClick={submitDrawing}
              disabled={saving}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save Drawing"}
            </button>
          </div>
          {saveMessage && <div className="mt-2 text-xs text-emerald-600">{saveMessage}</div>}
        </div>
      )}

      {showGeoGebra && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            GeoGebra
          </div>
          <GeoGebraWidget
            materialId={responseConfig?.geogebra?.materialId}
            width={responseConfig?.geogebra?.width || 640}
            height={responseConfig?.geogebra?.height || 360}
          />
        </div>
      )}
    </div>
  );
}
