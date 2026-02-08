"use client";

import { useMemo } from "react";

type LessonChoiceWidgetProps = {
  choices: string[];
  multi: boolean;
  value: string;
  explain?: boolean;
  explainValue?: string;
  onExplainChange?: (next: string) => void;
  onChange: (next: string) => void;
  onSubmit: () => Promise<void>;
  saving?: boolean;
};

export default function LessonChoiceWidget({
  choices,
  multi,
  value,
  explain,
  explainValue,
  onExplainChange,
  onChange,
  onSubmit,
  saving,
}: LessonChoiceWidgetProps) {
  const selected = useMemo(() => {
    if (!multi) return new Set(value ? [value] : []);
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
    } catch {
      // ignore parse errors
    }
    return new Set<string>();
  }, [value, multi]);

  const toggleChoice = (choice: string) => {
    if (!multi) {
      onChange(choice);
      return;
    }
    const next = new Set(selected);
    if (next.has(choice)) {
      next.delete(choice);
    } else {
      next.add(choice);
    }
    onChange(JSON.stringify(Array.from(next)));
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Choose your answer
      </div>
      <div className="space-y-2">
        {choices.map((choice, idx) => {
          const isSelected = selected.has(choice);
          return (
            <button
              key={`${choice}-${idx}`}
              type="button"
              onClick={() => toggleChoice(choice)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                isSelected
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold">
                {String.fromCharCode(65 + idx)}
              </span>
              <span className="align-middle">{choice}</span>
            </button>
          );
        })}
      </div>
      {explain && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Explain your answer
          </div>
          <textarea
            value={explainValue || ""}
            onChange={(e) => onExplainChange?.(e.target.value)}
            className="h-24 w-full rounded-md border border-zinc-200 px-2 py-2 text-sm outline-none focus:border-zinc-400"
            placeholder="Share your reasoning..."
          />
        </div>
      )}
      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || (!multi && !value) || (multi && selected.size === 0)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? "Saving..." : "Submit"}
        </button>
      </div>
    </div>
  );
}
