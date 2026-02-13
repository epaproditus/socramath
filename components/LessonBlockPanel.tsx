"use client";

import { LessonBlock } from "@/lib/lesson-blocks";
import {
  LessonResponseJson,
  LessonSlideCompletion,
  normalizeLessonResponseJson,
} from "@/lib/lesson-response";

type LessonBlockPanelProps = {
  blocks: LessonBlock[];
  responseJson: LessonResponseJson | null;
  completion?: LessonSlideCompletion | null;
  drawingReady?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (next: LessonResponseJson) => void;
  onSubmit: () => Promise<void>;
};

const nowIso = () => new Date().toISOString();

export default function LessonBlockPanel({
  blocks,
  responseJson,
  completion,
  drawingReady,
  disabled,
  saving,
  onChange,
  onSubmit,
}: LessonBlockPanelProps) {
  const normalized = normalizeLessonResponseJson(responseJson || {});
  const requiredTotal = completion?.requiredTotal || 0;
  const requiredDone = completion?.requiredDone || 0;

  const updateEntry = (
    blockId: string,
    updater: (prev: LessonResponseJson["blocks"][string] | undefined) => LessonResponseJson["blocks"][string]
  ) => {
    const next = normalizeLessonResponseJson(normalized);
    next.blocks[blockId] = updater(next.blocks[blockId]);
    onChange(next);
  };

  const toggleChoice = (blockId: string, choice: string, multi: boolean) => {
    updateEntry(blockId, (prev) => {
      if (!multi) {
        return {
          value: choice,
          explain: prev?.explain,
          updatedAt: nowIso(),
        };
      }

      const current = Array.isArray(prev?.value)
        ? [...prev.value]
        : typeof prev?.value === "string" && prev.value
        ? [prev.value]
        : [];
      const set = new Set(current);
      if (set.has(choice)) set.delete(choice);
      else set.add(choice);
      return {
        value: Array.from(set),
        explain: prev?.explain,
        updatedAt: nowIso(),
      };
    });
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Slide Blocks
          </div>
          {requiredTotal > 0 && (
            <div className="text-[11px] text-zinc-500">
              Completion: {requiredDone}/{requiredTotal}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || saving}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save Blocks"}
        </button>
      </div>

      <div className="space-y-3">
        {blocks.map((block) => {
          const entry = normalized.blocks[block.id];
          const blockComplete = completion?.blockStatus?.[block.id] ?? false;

          if (block.type === "prompt") {
            return (
              <div key={block.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  {block.title || "Prompt"}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{block.content}</div>
              </div>
            );
          }

          if (block.type === "text") {
            return (
              <div key={block.id} className="rounded-lg border border-zinc-200 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {block.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">{blockComplete ? "Done" : "In progress"}</div>
                </div>
                <textarea
                  value={typeof entry?.value === "string" ? entry.value : ""}
                  onChange={(e) =>
                    updateEntry(block.id, (prev) => ({
                      value: e.target.value,
                      explain: prev?.explain,
                      updatedAt: nowIso(),
                    }))
                  }
                  disabled={disabled}
                  className="h-24 w-full rounded-md border border-zinc-200 px-2 py-2 text-sm outline-none focus:border-zinc-400"
                  placeholder={block.placeholder || "Type your response..."}
                />
              </div>
            );
          }

          if (block.type === "mcq") {
            const selected = Array.isArray(entry?.value)
              ? new Set(entry.value)
              : typeof entry?.value === "string" && entry.value
              ? new Set([entry.value])
              : new Set<string>();
            return (
              <div key={block.id} className="rounded-lg border border-zinc-200 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {block.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">{blockComplete ? "Done" : "In progress"}</div>
                </div>
                <div className="space-y-2">
                  {block.choices.map((choice, idx) => {
                    const active = selected.has(choice);
                    return (
                      <button
                        key={`${block.id}-${idx}-${choice}`}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleChoice(block.id, choice, !!block.multi)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                          active
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-zinc-200 bg-white text-zinc-700"
                        }`}
                      >
                        {String.fromCharCode(65 + idx)}. {choice}
                      </button>
                    );
                  })}
                </div>
                {block.requireExplain && (
                  <textarea
                    value={entry?.explain || ""}
                    onChange={(e) =>
                      updateEntry(block.id, (prev) => ({
                        value: prev?.value,
                        explain: e.target.value,
                        updatedAt: nowIso(),
                      }))
                    }
                    disabled={disabled}
                    className="mt-2 h-20 w-full rounded-md border border-zinc-200 px-2 py-2 text-sm outline-none focus:border-zinc-400"
                    placeholder="Explain your choice..."
                  />
                )}
              </div>
            );
          }

          return (
            <div key={block.id} className="rounded-lg border border-zinc-200 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {block.label}
                </div>
                <div className="text-[11px] text-zinc-500">{blockComplete ? "Done" : "Pending"}</div>
              </div>
              <p className="text-xs text-zinc-600">
                Use the slide canvas to draw. {drawingReady ? "Drawing detected." : "No drawing detected yet."}
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={typeof entry?.value === "string" && entry.value === "done"}
                  disabled={disabled}
                  onChange={(e) =>
                    updateEntry(block.id, (prev) => ({
                      value: e.target.checked ? "done" : undefined,
                      explain: prev?.explain,
                      updatedAt: nowIso(),
                    }))
                  }
                />
                Mark drawing complete
              </label>
            </div>
          );
        })}

        {!blocks.length && (
          <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-500">
            No predefined blocks for this slide yet.
          </div>
        )}
      </div>
    </div>
  );
}
