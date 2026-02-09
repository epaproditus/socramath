"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type LessonWidgetPlacement = {
  id: string;
  type: "text" | "choice";
  x: number;
  y: number;
  w: number;
  h: number;
};

type LessonWidgetLayerProps = {
  widgets: LessonWidgetPlacement[];
  mode: "builder" | "student";
  choices?: string[];
  multi?: boolean;
  explain?: boolean;
  readOnly?: boolean;
  responses?: Record<string, unknown>;
  onWidgetsChange?: (widgets: LessonWidgetPlacement[]) => void;
  onResponseChange?: (widgetId: string, value: unknown) => void;
  containerRef: React.RefObject<HTMLDivElement>;
};

export default function LessonWidgetLayer({
  widgets,
  mode,
  choices = [],
  multi = false,
  explain = false,
  readOnly,
  responses,
  onWidgetsChange,
  onResponseChange,
  containerRef,
}: LessonWidgetLayerProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const widgetMap = useMemo(() => {
    const map: Record<string, LessonWidgetPlacement> = {};
    for (const widget of widgets) map[widget.id] = widget;
    return map;
  }, [widgets]);

  useEffect(() => {
    if (!draggingId || !dragStartRef.current) return;
    const handleMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaX = event.clientX - dragStartRef.current!.x;
      const deltaY = event.clientY - dragStartRef.current!.y;

      const nextX = (dragStartRef.current!.left + deltaX) / rect.width;
      const nextY = (dragStartRef.current!.top + deltaY) / rect.height;

      const current = widgetMap[draggingId];
      if (!current) return;
      const clampedX = Math.max(0, Math.min(1 - current.w, nextX));
      const clampedY = Math.max(0, Math.min(1 - current.h, nextY));
      const nextWidgets = widgets.map((widget) =>
        widget.id === draggingId ? { ...widget, x: clampedX, y: clampedY } : widget
      );
      onWidgetsChange?.(nextWidgets);
    };

    const handleUp = () => {
      setDraggingId(null);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingId, widgets, widgetMap, onWidgetsChange, containerRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {widgets.map((widget) => {
        const left = `${widget.x * 100}%`;
        const top = `${widget.y * 100}%`;
        const width = `${widget.w * 100}%`;
        const height = `${widget.h * 100}%`;
        const responseValue = responses?.[widget.id];

        return (
          <div
            key={widget.id}
            className="pointer-events-auto absolute"
            style={{ left, top, width, height }}
          >
            <div
              className={`relative h-full w-full rounded-lg border border-zinc-200 bg-white/90 p-2 shadow-sm ${
                mode === "builder" ? "cursor-move" : ""
              }`}
              onMouseDown={(event) => {
                if (mode !== "builder" || readOnly) return;
                const container = containerRef.current;
                if (!container) return;
                const rect = container.getBoundingClientRect();
                dragStartRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: widget.x * rect.width,
                  top: widget.y * rect.height,
                };
                setDraggingId(widget.id);
              }}
            >
              {mode === "builder" && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextWidgets = widgets.filter((item) => item.id !== widget.id);
                    onWidgetsChange?.(nextWidgets);
                  }}
                  className="absolute right-2 top-2 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500"
                >
                  Remove
                </button>
              )}

              {widget.type === "text" && (
                <textarea
                  value={typeof responseValue === "string" ? responseValue : ""}
                  onChange={(event) => onResponseChange?.(widget.id, event.target.value)}
                  placeholder="Student response..."
                  readOnly={mode === "builder"}
                  className="h-full w-full resize-none rounded-md border border-zinc-200 bg-white/90 px-2 py-1 text-xs outline-none focus:border-zinc-400"
                />
              )}

              {widget.type === "choice" && (
                <div className="space-y-2 text-xs text-zinc-700">
                  {choices.length === 0 && (
                    <div className="text-[11px] text-zinc-500">Add choices in the sidebar.</div>
                  )}
                  {choices.map((choice) => {
                    const selectionValue = explain
                      ? (responseValue as any)?.selection
                      : responseValue;
                    const isChecked = multi
                      ? Array.isArray(selectionValue) && selectionValue.includes(choice)
                      : selectionValue === choice;
                    return (
                      <label key={choice} className="flex items-center gap-2">
                        <input
                          type={multi ? "checkbox" : "radio"}
                          checked={!!isChecked}
                          onChange={() => {
                            if (mode === "builder") return;
                            if (multi) {
                              const existing =
                                Array.isArray(responseValue) && !explain
                                  ? responseValue
                                  : Array.isArray((responseValue as any)?.selection)
                                    ? (responseValue as any).selection
                                    : [];
                              const next = existing.includes(choice)
                                ? existing.filter((item) => item !== choice)
                                : [...existing, choice];
                              if (explain) {
                                onResponseChange?.(widget.id, {
                                  selection: next,
                                  explain: (responseValue as any)?.explain || "",
                                });
                              } else {
                                onResponseChange?.(widget.id, next);
                              }
                            } else {
                              if (explain) {
                                onResponseChange?.(widget.id, {
                                  selection: choice,
                                  explain: (responseValue as any)?.explain || "",
                                });
                              } else {
                                onResponseChange?.(widget.id, choice);
                              }
                            }
                          }}
                        />
                        <span>{choice}</span>
                      </label>
                    );
                  })}
                  {explain && (
                    <textarea
                      value={
                        typeof responseValue === "object" && responseValue && "explain" in responseValue
                          ? String((responseValue as any).explain || "")
                          : ""
                      }
                      onChange={(event) => {
                        if (mode === "builder") return;
                        const base =
                          typeof responseValue === "object" && responseValue ? (responseValue as any) : {};
                        onResponseChange?.(widget.id, {
                          ...base,
                          explain: event.target.value,
                        });
                      }}
                      placeholder="Explain your answer..."
                      className="mt-2 h-16 w-full resize-none rounded-md border border-zinc-200 bg-white/90 px-2 py-1 text-xs outline-none focus:border-zinc-400"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
