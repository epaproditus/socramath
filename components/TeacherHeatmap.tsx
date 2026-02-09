"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Filter, Hand, Snowflake, Download, Shrink, Glasses, CheckCircle2, List } from "lucide-react";

type HeatmapPayload = {
  lesson: { id: string; title: string; pageCount: number };
  session: { id: string; mode: "instructor" | "student"; currentSlideIndex: number };
  slides: { id: string; index: number }[];
  students: { id: string; name: string; email?: string | null }[];
  responses: { key: string; response: string; drawingPath: string; updatedAt: string }[];
};

type SortMode = "first" | "last" | "recent";

export default function TeacherHeatmap() {
  const [data, setData] = useState<HeatmapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeze, setFreeze] = useState(false);
  const [paceModal, setPaceModal] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [flatMode, setFlatMode] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("first");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/lesson-heatmap");
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err?.message || "Failed to load heatmap");
      }
    };
    load();
    const interval = setInterval(() => {
      if (!freeze) load();
    }, 3000);
    return () => clearInterval(interval);
  }, [freeze]);

  const responsesMap = useMemo(() => {
    const map = new Map<string, { response: string; drawingPath: string; updatedAt: string }>();
    data?.responses.forEach((r) => map.set(r.key, r));
    return map;
  }, [data?.responses]);

  const slides = data?.slides || [];
  const students = useMemo(() => {
    if (!data?.students) return [];
    const sorted = [...data.students];
    if (sortMode === "first") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === "last") {
      sorted.sort((a, b) => a.name.split(" ").slice(-1)[0].localeCompare(b.name.split(" ").slice(-1)[0]));
    } else {
      sorted.sort((a, b) => {
        const latestA = slides.reduce((acc, slide) => {
          const key = `${a.id}:${slide.id}`;
          const item = responsesMap.get(key);
          if (!item) return acc;
          const ts = new Date(item.updatedAt).getTime();
          return Math.max(acc, ts);
        }, 0);
        const latestB = slides.reduce((acc, slide) => {
          const key = `${b.id}:${slide.id}`;
          const item = responsesMap.get(key);
          if (!item) return acc;
          const ts = new Date(item.updatedAt).getTime();
          return Math.max(acc, ts);
        }, 0);
        return latestB - latestA;
      });
    }
    return sorted;
  }, [data?.students, sortMode, responsesMap, slides]);

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!data) {
    return <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading heatmap…</div>;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-zinc-700">Heatmap</div>
        <div className="flex items-center gap-2">
          <button className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs">Live Activity</button>
          <button className="rounded-full border border-zinc-200 p-2" title="Help queue">
            <Hand className="h-4 w-4" />
          </button>
          <button className="rounded-full border border-zinc-200 p-2" title="Pace students" onClick={() => setPaceModal(true)}>
            <Filter className="h-4 w-4" />
          </button>
          <button className={`rounded-full border border-zinc-200 p-2 ${freeze ? "bg-zinc-100" : ""}`} title="Freeze students" onClick={() => setFreeze((v) => !v)}>
            <Snowflake className="h-4 w-4" />
          </button>
          <button className="rounded-full border border-zinc-200 p-2" title="Download">
            <Download className="h-4 w-4" />
          </button>
          <button className="rounded-full border border-zinc-200 p-2" title="Compress view">
            <Shrink className="h-4 w-4" />
          </button>
          <button className={`rounded-full border border-zinc-200 p-2 ${hideNames ? "bg-zinc-100" : ""}`} title="Hide names" onClick={() => setHideNames((v) => !v)}>
            <Glasses className="h-4 w-4" />
          </button>
          <button className={`rounded-full border border-zinc-200 p-2 ${flatMode ? "bg-zinc-100" : ""}`} title="Hide results" onClick={() => setFlatMode((v) => !v)}>
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <button className="rounded-full border border-zinc-200 p-2" title="Sort students" onClick={() => setSortMode((v) => (v === "first" ? "last" : v === "last" ? "recent" : "first"))}>
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-3 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `220px repeat(${slides.length}, 84px)` }}>
          <div className="sticky left-0 z-10 bg-white" />
          {slides.map((slide) => (
            <div key={slide.id} className="text-center text-[11px] text-zinc-500">
              {slide.index}
            </div>
          ))}
          {students.map((student) => (
            <>
              <div
                key={student.id}
                className="sticky left-0 z-10 flex items-center border-t border-zinc-100 bg-white px-2 py-2 text-xs text-zinc-600"
              >
                {hideNames ? `Student ${student.id.slice(0, 4)}` : student.name}
              </div>
              {slides.map((slide) => {
                const cell = responsesMap.get(`${student.id}:${slide.id}`);
                const hasResponse = !!cell?.response || !!cell?.drawingPath;
                const color = flatMode
                  ? hasResponse
                    ? "bg-blue-100"
                    : "bg-zinc-100"
                  : hasResponse
                  ? "bg-emerald-200"
                  : "bg-zinc-100";
                return (
                  <div
                    key={`${student.id}-${slide.id}`}
                    className={`border-t border-l border-zinc-100 h-10 ${color}`}
                    title={cell?.updatedAt ? new Date(cell.updatedAt).toLocaleString() : "No response"}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {paceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[420px] rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Pace students</div>
              <button className="text-zinc-400" onClick={() => setPaceModal(false)}>
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              Select problems to allow. This is UI only for now.
            </p>
            <div className="mt-4 space-y-2 max-h-64 overflow-auto">
              {slides.map((slide) => (
                <label key={slide.id} className="flex items-center gap-2 text-sm text-zinc-600">
                  <input type="checkbox" defaultChecked />
                  Problem {slide.index}
                </label>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button className="rounded-full border border-zinc-200 px-4 py-2 text-sm" onClick={() => setPaceModal(false)}>
                Cancel
              </button>
              <button className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white" onClick={() => setPaceModal(false)}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
