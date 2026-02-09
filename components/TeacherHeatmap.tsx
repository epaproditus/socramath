"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Hand, Snowflake, Download, Shrink, Glasses, CheckCircle2, List, Timer } from "lucide-react";
import { getRealtimeSocket } from "@/lib/realtime-client";

type HeatmapPayload = {
  lesson: { id: string; title: string; pageCount: number };
  session: {
    id: string;
    mode: "instructor" | "student";
    currentSlideIndex: number;
    isFrozen: boolean;
    paceConfig: { allowedSlides?: number[] } | null;
    timerEndsAt?: string | null;
    timerRemainingSec?: number | null;
    timerRunning?: boolean;
  };
  slides: { id: string; index: number }[];
  students: { id: string; name: string; email?: string | null }[];
  states?: { userId: string; currentSlideIndex: number }[];
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
  const [timerModal, setTimerModal] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState("5");
  const [timerSeconds, setTimerSeconds] = useState("0");
  const [paceSelection, setPaceSelection] = useState<number[]>([]);
  const [selectedCell, setSelectedCell] = useState<{
    studentId: string;
    studentName: string;
    slideId: string;
    slideIndex: number;
  } | null>(null);
  const paceInitRef = useRef(false);

  const slides = useMemo(() => data?.slides || [], [data?.slides]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lesson-heatmap");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load heatmap");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!freeze) load();
    }, 3000);
    return () => clearInterval(interval);
  }, [freeze, load]);

  useEffect(() => {
    if (!data?.lesson?.id || !data?.session?.id) return;
    const socket = getRealtimeSocket();
    if (!socket) return;
    socket.emit("join", { lessonId: data.lesson.id, sessionId: data.session.id });
    const handleUpdate = (payload: { lessonId?: string; sessionId?: string }) => {
      if (payload.sessionId && payload.sessionId !== data.session.id) return;
      if (payload.lessonId && payload.lessonId !== data.lesson.id) return;
      load();
    };
    socket.on("lesson:update", handleUpdate);
    return () => {
      socket.off("lesson:update", handleUpdate);
    };
  }, [data?.lesson?.id, data?.session?.id, load]);

  useEffect(() => {
    if (!paceModal) {
      paceInitRef.current = false;
      return;
    }
    if (paceInitRef.current) return;
    if (data?.session.paceConfig?.allowedSlides) {
      setPaceSelection([...data.session.paceConfig.allowedSlides]);
    } else {
      setPaceSelection(slides.map((slide) => slide.index));
    }
    paceInitRef.current = true;
  }, [paceModal, data?.session.paceConfig, slides]);

  const updateSession = async (updates: Record<string, unknown>) => {
    if (!data?.session.id) return;
    await fetch("/api/lesson-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: data.session.id, ...updates }),
    });
    const res = await fetch("/api/lesson-heatmap");
    if (res.ok) {
      setData(await res.json());
    }
  };

  const remainingSeconds = useMemo(() => {
    if (!data?.session) return 0;
    if (data.session.timerRunning && data.session.timerEndsAt) {
      const end = new Date(data.session.timerEndsAt).getTime();
      return Math.max(0, Math.floor((end - Date.now()) / 1000));
    }
    if (typeof data.session.timerRemainingSec === "number") {
      return Math.max(0, data.session.timerRemainingSec);
    }
    return 0;
  }, [data?.session]);

  const formatTime = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const adjustTimerBy = async (deltaSec: number) => {
    if (!data?.session) return;
    const nextRemaining = Math.max(0, remainingSeconds + deltaSec);
    if (data.session.timerRunning) {
      const endsAt = new Date(Date.now() + nextRemaining * 1000).toISOString();
      await updateSession({
        timerRunning: true,
        timerEndsAt: endsAt,
        timerRemainingSec: null,
      });
    } else {
      await updateSession({
        timerRunning: false,
        timerEndsAt: null,
        timerRemainingSec: nextRemaining,
      });
    }
  };

  const responsesMap = useMemo(() => {
    const map = new Map<string, { response: string; drawingPath: string; updatedAt: string }>();
    data?.responses.forEach((r) => map.set(r.key, r));
    return map;
  }, [data?.responses]);

  const studentSlideMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.states?.forEach((state) => {
      map.set(state.userId, state.currentSlideIndex);
    });
    return map;
  }, [data?.states]);

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
          <button
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-400 opacity-60"
            disabled
            aria-disabled
            title="Live Activity (coming soon)"
          >
            Live Activity
          </button>
          <button
            className="rounded-full border border-zinc-200 p-2 text-zinc-400 opacity-60"
            disabled
            aria-disabled
            title="Help queue (coming soon)"
          >
            <Hand className="h-4 w-4" />
          </button>
          <button className="rounded-full border border-zinc-200 p-2" title="Pace students" onClick={() => setPaceModal(true)}>
            <Filter className="h-4 w-4" />
          </button>
          <button
            className={`rounded-full border border-zinc-200 p-2 ${data.session.isFrozen ? "bg-zinc-100" : ""}`}
            title="Freeze students"
            onClick={() => updateSession({ isFrozen: !data.session.isFrozen })}
          >
            <Snowflake className="h-4 w-4" />
          </button>
          <button
            className="rounded-full border border-zinc-200 p-2 text-zinc-400 opacity-60"
            disabled
            aria-disabled
            title="Download (coming soon)"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            className="rounded-full border border-zinc-200 p-2 text-zinc-400 opacity-60"
            disabled
            aria-disabled
            title="Compress view (coming soon)"
          >
            <Shrink className="h-4 w-4" />
          </button>
          <button
            className="rounded-full border border-zinc-200 p-2"
            title="Timer"
            onClick={() => setTimerModal(true)}
          >
            <Timer className="h-4 w-4" />
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
      {data.session.timerRunning || data.session.timerRemainingSec ? (
        <div className="text-xs text-zinc-500">Timer: {formatTime(remainingSeconds)}</div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-3 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `220px repeat(${slides.length}, 84px)` }}>
          <div className="sticky left-0 z-10 bg-white" />
          {slides.map((slide) => (
            <div key={slide.id} className="text-center text-[11px] text-zinc-500">
              {slide.index}
            </div>
          ))}
          {students.map((student) => (
            <div key={student.id} className="contents">
              <div
                className="sticky left-0 z-10 flex items-center border-t border-zinc-100 bg-white px-2 py-2 text-xs text-zinc-600"
              >
                {hideNames ? `Student ${student.id.slice(0, 4)}` : student.name}
              </div>
              {slides.map((slide) => {
                const cell = responsesMap.get(`${student.id}:${slide.id}`);
                const hasResponse = !!cell?.response || !!cell?.drawingPath;
                const studentSlideIndex =
                  data?.session.mode === "student"
                    ? studentSlideMap.get(student.id)
                    : data?.session.currentSlideIndex;
                const isActiveSlide = studentSlideIndex === slide.index;
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
                    className={`border-t border-l border-zinc-100 h-10 ${color} cursor-pointer ${isActiveSlide ? "ring-2 ring-sky-500 ring-inset" : ""}`}
                    title={cell?.updatedAt ? new Date(cell.updatedAt).toLocaleString() : "No response"}
                    onClick={() =>
                      setSelectedCell({
                        studentId: student.id,
                        studentName: student.name,
                        slideId: slide.id,
                        slideIndex: slide.index,
                      })
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[720px] max-w-[92vw] rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">
                {selectedCell.studentName} · Problem {selectedCell.slideIndex}
              </div>
              <button className="text-zinc-400" onClick={() => setSelectedCell(null)}>
                ✕
              </button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Response</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                  {responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.response || "No response yet."}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Drawing</div>
                {responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.drawingPath ? (
                  <img
                    src={responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.drawingPath}
                    alt="Student drawing"
                    className="mt-2 h-60 w-full rounded-lg border border-zinc-200 object-contain bg-white"
                  />
                ) : (
                  <div className="mt-2 text-sm text-zinc-500">No drawing yet.</div>
                )}
              </div>
            </div>
            <div className="mt-4 text-xs text-zinc-500">
              Live updates are enabled while this modal is open.
            </div>
          </div>
        </div>
      )}

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
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={paceSelection.length === slides.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setPaceSelection(slides.map((slide) => slide.index));
                    } else {
                      setPaceSelection([]);
                    }
                  }}
                />
                All problems
              </label>
              {slides.map((slide) => (
                <label key={slide.id} className="flex items-center gap-2 text-sm text-zinc-600">
                  <input
                    type="checkbox"
                    checked={paceSelection.includes(slide.index)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPaceSelection((prev) => Array.from(new Set([...prev, slide.index])));
                      } else {
                        setPaceSelection((prev) => prev.filter((idx) => idx !== slide.index));
                      }
                    }}
                  />
                  Problem {slide.index}
                </label>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button className="rounded-full border border-zinc-200 px-4 py-2 text-sm" onClick={() => setPaceModal(false)}>
                Cancel
              </button>
              <button
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white"
                onClick={async () => {
                  await updateSession({ paceConfig: { allowedSlides: paceSelection } });
                  setPaceModal(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {timerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[420px] rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Timer</div>
              <button className="text-zinc-400" onClick={() => setTimerModal(false)}>
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-500">Set a timer and freeze when it ends.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                value={timerMinutes}
                onChange={(e) => setTimerMinutes(e.target.value)}
                className="w-24 rounded-md border border-zinc-200 px-2 py-2 text-sm"
              />
              <span className="text-sm text-zinc-500">minutes</span>
              <input
                type="number"
                min={0}
                max={59}
                value={timerSeconds}
                onChange={(e) => setTimerSeconds(e.target.value)}
                className="w-24 rounded-md border border-zinc-200 px-2 py-2 text-sm"
              />
              <span className="text-sm text-zinc-500">seconds</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">
                Current: {formatTime(remainingSeconds)}
              </span>
              <button
                className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-50"
                onClick={() => adjustTimerBy(30)}
              >
                +30s
              </button>
              <button
                className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-50"
                onClick={() => adjustTimerBy(60)}
              >
                +1m
              </button>
              <button
                className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-50"
                onClick={() => adjustTimerBy(300)}
              >
                +5m
              </button>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              {data.session.timerRunning ? (
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm"
                  onClick={async () => {
                    const remaining = remainingSeconds;
                    await updateSession({
                      timerRunning: false,
                      timerEndsAt: null,
                      timerRemainingSec: remaining,
                    });
                  }}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm"
                  onClick={async () => {
                    const remaining =
                      Math.max(0, Number(timerMinutes) || 0) * 60 +
                      Math.min(59, Math.max(0, Number(timerSeconds) || 0));
                    const endsAt = new Date(Date.now() + remaining * 1000).toISOString();
                    await updateSession({
                      isFrozen: false,
                      timerRunning: true,
                      timerEndsAt: endsAt,
                      timerRemainingSec: null,
                    });
                  }}
                >
                  Start
                </button>
              )}
              {!data.session.timerRunning && data.session.timerRemainingSec ? (
                <button
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm"
                  onClick={async () => {
                    const remaining = data.session.timerRemainingSec || 0;
                    const endsAt = new Date(Date.now() + remaining * 1000).toISOString();
                    await updateSession({
                      isFrozen: false,
                      timerRunning: true,
                      timerEndsAt: endsAt,
                      timerRemainingSec: null,
                    });
                  }}
                >
                  Resume
                </button>
              ) : null}
              <button
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white"
                onClick={async () => {
                  await updateSession({
                    timerRunning: false,
                    timerEndsAt: null,
                    timerRemainingSec: 0,
                  });
                  setTimerModal(false);
                }}
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
