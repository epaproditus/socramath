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
  responses: { key: string; response: string; drawingPath: string; drawingText?: string; updatedAt: string }[];
  assessments?: { key: string; label: AssessmentLabel; reason?: string; updatedAt?: string }[];
};

type SortMode = "first" | "last" | "recent";
type AssessmentLabel = "green" | "yellow" | "red" | "grey";

const assessmentBorderClass = (label?: AssessmentLabel) => {
  if (label === "green") return "border-emerald-400";
  if (label === "yellow") return "border-amber-400";
  if (label === "red") return "border-rose-400";
  return "border-zinc-200";
};

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
  const [selectedSlide, setSelectedSlide] = useState<{
    slideId: string;
    slideIndex: number;
  } | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<{
    studentId: string;
    studentName: string;
    slideIndex: number;
  } | null>(null);
  const [studentSlideIndex, setStudentSlideIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [slideSummary, setSlideSummary] = useState<string | null>(null);
  const [studentSummary, setStudentSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<"slide" | "student" | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState<"slide" | "cell" | "student" | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const paceInitRef = useRef(false);

  const slides = useMemo(() => data?.slides || [], [data?.slides]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lesson-heatmap");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
      setLastUpdatedAt(new Date());
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "Failed to load heatmap";
      setError(message || "Failed to load heatmap");
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
    const handleConnect = () => {
      setSocketConnected(true);
      setSocketError(null);
      socket.emit("join", { lessonId: data.lesson.id, sessionId: data.session.id });
    };
    const handleDisconnect = () => setSocketConnected(false);
    const handleConnectError = (err: Error) => {
      setSocketConnected(false);
      setSocketError(err?.message || "Connection error");
    };
    const handleUpdate = (payload: { lessonId?: string; sessionId?: string }) => {
      if (payload.sessionId && payload.sessionId !== data.session.id) return;
      if (payload.lessonId && payload.lessonId !== data.lesson.id) return;
      load();
    };
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("lesson:update", handleUpdate);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
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

  const fetchSummary = async (payload: { slideId?: string; studentId?: string }) => {
    if (!data?.session.id) return;
    setSummaryError(null);
    setSummaryLoading(payload.slideId ? "slide" : "student");
    try {
      const res = await fetch("/api/lesson-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: data.session.id, ...payload }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to summarize");
      }
      const json = await res.json();
      if (payload.slideId) {
        setSlideSummary(json.summary || "");
      } else {
        setStudentSummary(json.summary || "");
      }
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "Failed to summarize";
      setSummaryError(message || "Failed to summarize");
    } finally {
      setSummaryLoading(null);
    }
  };

  const runAssessment = async (payload: { slideId: string; studentId?: string; mode: "slide" | "cell" | "student" }) => {
    if (!data?.session.id) return;
    setAssessmentError(null);
    setAssessmentLoading(payload.mode);
    try {
      const res = await fetch("/api/lesson-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: data.session.id,
          slideId: payload.slideId,
          studentId: payload.studentId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to assess");
      }
      await load();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "Failed to assess";
      setAssessmentError(message);
    } finally {
      setAssessmentLoading(null);
    }
  };

  const setManualAssessment = async (payload: {
    slideId: string;
    studentId: string;
    label: AssessmentLabel;
    mode: "cell" | "student";
  }) => {
    if (!data?.session?.id) return;
    setAssessmentError(null);
    setAssessmentLoading(payload.mode);
    try {
      const res = await fetch("/api/lesson-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: data.session.id,
          slideId: payload.slideId,
          studentId: payload.studentId,
          label: payload.label,
          reason: "Manual override.",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update assessment");
      }
      await load();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "")
          : "Failed to update assessment";
      setAssessmentError(message || "Failed to update assessment");
    } finally {
      setAssessmentLoading(null);
    }
  };

  const renderOverrideButtons = (payload: { slideId: string; studentId: string; mode: "cell" | "student" }) => (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-zinc-500">Set:</span>
      {(["green", "yellow", "red", "grey"] as AssessmentLabel[]).map((label) => (
        <button
          key={`${payload.studentId}-${payload.slideId}-${label}`}
          type="button"
          className={`h-7 rounded-full border px-2 text-[11px] font-semibold ${
            label === "green"
              ? "border-emerald-300 bg-emerald-100 text-emerald-700"
              : label === "yellow"
                ? "border-amber-300 bg-amber-100 text-amber-700"
                : label === "red"
                  ? "border-rose-300 bg-rose-100 text-rose-700"
                  : "border-zinc-300 bg-zinc-100 text-zinc-600"
          }`}
          onClick={() =>
            setManualAssessment({
              slideId: payload.slideId,
              studentId: payload.studentId,
              label,
              mode: payload.mode,
            })
          }
          disabled={assessmentLoading === payload.mode}
        >
          {label}
        </button>
      ))}
    </div>
  );

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

  const assessmentMap = useMemo(() => {
    const map = new Map<string, { label: AssessmentLabel; reason?: string }>();
    data?.assessments?.forEach((assessment) => {
      map.set(assessment.key, { label: assessment.label, reason: assessment.reason || "" });
    });
    return map;
  }, [data?.assessments]);

  const studentSlideMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.states?.forEach((state) => {
      map.set(state.userId, state.currentSlideIndex);
    });
    return map;
  }, [data?.states]);

  useEffect(() => {
    if (selectedCell) {
      setZoom(1);
    }
  }, [selectedCell?.studentId, selectedCell?.slideId]);

  useEffect(() => {
    if (!selectedStudent) return;
    setZoom(1);
  }, [selectedStudent?.studentId, selectedStudent?.slideIndex]);

  useEffect(() => {
    if (selectedSlide) {
      setSlideSummary(null);
      setSummaryError(null);
    }
  }, [selectedSlide?.slideId]);

  useEffect(() => {
    if (selectedStudent) {
      setStudentSummary(null);
      setSummaryError(null);
    }
  }, [selectedStudent?.studentId]);

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

  const selectedCellAssessment = selectedCell
    ? assessmentMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)
    : undefined;
  const selectedStudentActiveAssessment =
    selectedStudent && studentSlideIndex !== null
      ? (() => {
          const activeSlide = slides.find((slide) => slide.index === studentSlideIndex);
          return activeSlide
            ? assessmentMap.get(`${selectedStudent.studentId}:${activeSlide.id}`)
            : undefined;
        })()
      : undefined;

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
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              socketConnected ? "bg-emerald-400" : "bg-zinc-300"
            }`}
          />
          {socketConnected ? "Live connected" : "Live disconnected"}
        </div>
        <div>
          Last update: {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : "—"}
        </div>
      </div>
      {socketError && (
        <div className="text-xs text-zinc-400">Live error: {socketError}</div>
      )}
      {data.session.timerRunning || data.session.timerRemainingSec ? (
        <div className="text-xs text-zinc-500">Timer: {formatTime(remainingSeconds)}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-300" /> Not assessed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-300" /> Green
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Yellow
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-300" /> Red
        </span>
      </div>
      {assessmentError ? <div className="text-xs text-red-500">{assessmentError}</div> : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-3 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `220px repeat(${slides.length}, 84px)` }}>
          <div className="sticky left-0 z-10 bg-white" />
          {slides.map((slide) => (
            <button
              key={slide.id}
              className="text-center text-[11px] text-zinc-500 hover:text-zinc-800"
              onClick={() => {
                setSelectedCell(null);
                setSelectedStudent(null);
                setSelectedSlide({ slideId: slide.id, slideIndex: slide.index });
              }}
            >
              {slide.index}
            </button>
          ))}
          {students.map((student) => (
            <div key={student.id} className="contents">
              <button
                className="sticky left-0 z-10 flex items-center border-t border-zinc-100 bg-white px-2 py-2 text-xs text-zinc-600 hover:text-zinc-900"
                onClick={() => {
                  const current = studentSlideMap.get(student.id) ?? data?.session.currentSlideIndex ?? 1;
                  setSelectedCell(null);
                  setSelectedSlide(null);
                  setSelectedStudent({
                    studentId: student.id,
                    studentName: student.name,
                    slideIndex: current,
                  });
                  setStudentSlideIndex(current);
                }}
              >
                {hideNames ? `Student ${student.id.slice(0, 4)}` : student.name}
              </button>
              {slides.map((slide) => {
                const cell = responsesMap.get(`${student.id}:${slide.id}`);
                const assessment = assessmentMap.get(`${student.id}:${slide.id}`);
                const hasResponse = !!cell?.response || !!cell?.drawingPath;
                const studentSlideIndex =
                  data?.session.mode === "student"
                    ? studentSlideMap.get(student.id)
                    : data?.session.currentSlideIndex;
                const isActiveSlide = studentSlideIndex === slide.index;
                const color = (() => {
                  if (flatMode) {
                    return hasResponse ? "bg-blue-100" : "bg-zinc-100";
                  }
                  if (!assessment) return "bg-zinc-100";
                  if (assessment.label === "green") return "bg-emerald-300";
                  if (assessment.label === "yellow") return "bg-amber-300";
                  if (assessment.label === "red") return "bg-rose-300";
                  return "bg-zinc-100";
                })();
                const tooltip = [
                  cell?.updatedAt ? new Date(cell.updatedAt).toLocaleString() : "No response",
                  assessment ? `Assessment: ${assessment.label}` : "Assessment: not assessed",
                  assessment?.reason ? `Reason: ${assessment.reason}` : "",
                ]
                  .filter(Boolean)
                  .join("\n");
                return (
                  <div
                    key={`${student.id}-${slide.id}`}
                    className={`border-t border-l border-zinc-100 h-10 ${color} cursor-pointer ${isActiveSlide ? "ring-2 ring-sky-500 ring-inset" : ""}`}
                    title={tooltip}
                    onClick={() => {
                      setSelectedSlide(null);
                      setSelectedStudent(null);
                      setSelectedCell({
                        studentId: student.id,
                        studentName: student.name,
                        slideId: slide.id,
                        slideIndex: slide.index,
                      });
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="h-[92vh] w-[92vw] max-w-[1600px] rounded-2xl bg-white p-6 shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <span className="font-semibold text-zinc-700">Heatmap</span>
                <span>›</span>
                <span>Problem {selectedCell.slideIndex}</span>
                <span>›</span>
                <span className="font-semibold text-zinc-700">{selectedCell.studentName}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() =>
                    runAssessment({
                      slideId: selectedCell.slideId,
                      studentId: selectedCell.studentId,
                      mode: "cell",
                    })
                  }
                  disabled={assessmentLoading === "cell"}
                >
                  {assessmentLoading === "cell" ? "Assessing..." : "Assess"}
                </button>
                {renderOverrideButtons({
                  slideId: selectedCell.slideId,
                  studentId: selectedCell.studentId,
                  mode: "cell",
                })}
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                >
                  −
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom(1)}
                >
                  Reset
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))}
                >
                  +
                </button>
                <button className="text-zinc-400" onClick={() => setSelectedCell(null)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0 grid gap-5 lg:grid-cols-[300px_1fr]">
              <aside
                className={`rounded-2xl border-2 ${assessmentBorderClass(
                  selectedCellAssessment?.label
                )} bg-white p-3 shadow-sm flex flex-col`}
              >
                <div className="text-xs font-semibold uppercase text-zinc-500">Problem {selectedCell.slideIndex}</div>
                <div className="mt-3 flex-1 overflow-auto">
                  {data?.lesson?.id ? (
                    (() => {
                      const digits = String(data.lesson.pageCount || slides.length || 1).length;
                      const thumbFilename = `${String(selectedCell.slideIndex).padStart(digits, "0")}.png`;
                      return (
                        <img
                          src={`/uploads/lessons/${data.lesson.id}/slides/${thumbFilename}?v=${encodeURIComponent(
                            selectedCell.slideId
                          )}`}
                          alt={`Problem ${selectedCell.slideIndex}`}
                          className="w-full rounded-xl border border-zinc-200 object-contain bg-zinc-50"
                        />
                      );
                    })()
                  ) : (
                    <div className="text-sm text-zinc-500">No slide available.</div>
                  )}
                </div>
              </aside>

              <div
                className={`h-full rounded-2xl border-2 ${assessmentBorderClass(
                  selectedCellAssessment?.label
                )} bg-zinc-50 p-3 flex flex-col min-h-0`}
              >
                <div className="text-xs font-semibold uppercase text-zinc-500">Live Work</div>
                <div
                  className={`mt-2 flex-1 min-h-0 overflow-auto rounded-xl border-2 ${assessmentBorderClass(
                    selectedCellAssessment?.label
                  )} bg-white`}
                  onWheel={(e) => {
                    if (!e.ctrlKey && !e.metaKey) return;
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    setZoom((z) =>
                      Math.min(3, Math.max(0.5, Math.round((z + delta) * 10) / 10))
                    );
                  }}
                >
                  {responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.drawingPath ? (
                    <div
                      className="h-full w-full"
                      style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <img
                        src={`${responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.drawingPath}?v=${encodeURIComponent(
                          responsesMap.get(`${selectedCell.studentId}:${selectedCell.slideId}`)?.updatedAt || ""
                        )}`}
                        alt="Student drawing"
                        className="h-full w-auto object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                      No drawing yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-zinc-500">
              Live updates are enabled while this modal is open.
            </div>
          </div>
        </div>
      )}

      {selectedSlide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="h-[92vh] w-[92vw] max-w-[1600px] rounded-2xl bg-white p-6 shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <span className="font-semibold text-zinc-700">Heatmap</span>
                <span>›</span>
                <span className="font-semibold text-zinc-700">Problem {selectedSlide.slideIndex}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() =>
                    runAssessment({
                      slideId: selectedSlide.slideId,
                      mode: "slide",
                    })
                  }
                  disabled={assessmentLoading === "slide"}
                >
                  {assessmentLoading === "slide" ? "Assessing..." : "Assess Colors"}
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => fetchSummary({ slideId: selectedSlide.slideId })}
                  disabled={summaryLoading === "slide"}
                >
                  {summaryLoading === "slide" ? "Summarizing..." : "Summarize"}
                </button>
                <button className="text-zinc-400" onClick={() => setSelectedSlide(null)}>
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-4 flex-1 min-h-0 grid gap-5 lg:grid-cols-[300px_1fr]">
              <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm flex flex-col">
                <div className="text-xs font-semibold uppercase text-zinc-500">Problem {selectedSlide.slideIndex}</div>
                <div className="mt-3 flex-1 overflow-auto">
                  {data?.lesson?.id ? (
                    (() => {
                      const digits = String(data.lesson.pageCount || slides.length || 1).length;
                      const thumbFilename = `${String(selectedSlide.slideIndex).padStart(digits, "0")}.png`;
                      return (
                        <img
                          src={`/uploads/lessons/${data.lesson.id}/slides/${thumbFilename}?v=${encodeURIComponent(
                            selectedSlide.slideId
                          )}`}
                          alt={`Problem ${selectedSlide.slideIndex}`}
                          className="w-full rounded-xl border border-zinc-200 object-contain bg-zinc-50"
                        />
                      );
                    })()
                  ) : (
                    <div className="text-sm text-zinc-500">No slide available.</div>
                  )}
                </div>
              </aside>
              <div className="h-full rounded-2xl border border-zinc-200 bg-zinc-50 p-3 flex flex-col min-h-0">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-zinc-500">Students</div>
                </div>
                {slideSummary && (
                  <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700 whitespace-pre-wrap">
                    {slideSummary}
                  </div>
                )}
                {summaryError && (
                  <div className="mt-2 text-xs text-red-500">{summaryError}</div>
                )}
                <div className="mt-3 flex-1 min-h-0 overflow-auto">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {students.map((student) => {
                      const cell = responsesMap.get(`${student.id}:${selectedSlide.slideId}`);
                      const assessment = assessmentMap.get(`${student.id}:${selectedSlide.slideId}`);
                      const drawingPath = cell?.drawingPath || "";
                      return (
                        <button
                          key={`slide-${selectedSlide.slideId}-${student.id}`}
                          className={`rounded-xl border-2 ${assessmentBorderClass(
                            assessment?.label
                          )} bg-white p-3 text-left hover:shadow-sm`}
                          onClick={() => {
                            setSelectedSlide(null);
                            setSelectedStudent({
                              studentId: student.id,
                              studentName: student.name,
                              slideIndex: selectedSlide.slideIndex,
                            });
                            setStudentSlideIndex(selectedSlide.slideIndex);
                          }}
                        >
                          <div className="text-xs font-semibold text-zinc-600">{student.name}</div>
                          <div
                            className={`mt-2 h-40 rounded-lg border-2 ${assessmentBorderClass(
                              assessment?.label
                            )} bg-zinc-50 overflow-hidden`}
                          >
                            {drawingPath ? (
                              <img
                                src={`${drawingPath}?v=${encodeURIComponent(cell?.updatedAt || "")}`}
                                alt={`${student.name} work`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                                No work yet
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 text-xs text-zinc-500">
              Click a student to open their full view.
            </div>
          </div>
        </div>
      )}

      {selectedStudent && studentSlideIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="h-[92vh] w-[92vw] max-w-[1600px] rounded-2xl bg-white p-6 shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <span className="font-semibold text-zinc-700">Heatmap</span>
                <span>›</span>
                <span className="font-semibold text-zinc-700">{selectedStudent.studentName}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => {
                    const selected = slides.find((slide) => slide.index === studentSlideIndex);
                    if (!selected) return;
                    runAssessment({
                      slideId: selected.id,
                      studentId: selectedStudent.studentId,
                      mode: "student",
                    });
                  }}
                  disabled={assessmentLoading === "student"}
                >
                  {assessmentLoading === "student" ? "Assessing..." : "Assess This Slide"}
                </button>
                {(() => {
                  const selected = slides.find((slide) => slide.index === studentSlideIndex);
                  if (!selected) return null;
                  return renderOverrideButtons({
                    slideId: selected.id,
                    studentId: selectedStudent.studentId,
                    mode: "student",
                  });
                })()}
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => fetchSummary({ studentId: selectedStudent.studentId })}
                  disabled={summaryLoading === "student"}
                >
                  {summaryLoading === "student" ? "Summarizing..." : "Summarize"}
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                >
                  −
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom(1)}
                >
                  Reset
                </button>
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                  onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))}
                >
                  +
                </button>
                <button className="text-zinc-400" onClick={() => setSelectedStudent(null)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0 grid gap-5 lg:grid-cols-[300px_1fr]">
              <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm flex flex-col min-h-0">
                <div className="text-xs font-semibold uppercase text-zinc-500">Problems</div>
                <div className="mt-3 flex-1 overflow-auto space-y-3">
                  {slides.map((slide) => {
                    const isActive = slide.index === studentSlideIndex;
                    const cell = responsesMap.get(`${selectedStudent.studentId}:${slide.id}`);
                    const assessment = assessmentMap.get(`${selectedStudent.studentId}:${slide.id}`);
                    const drawingPath = cell?.drawingPath || "";
                    return (
                      <button
                        key={`student-${selectedStudent.studentId}-${slide.id}`}
                        className={`w-full rounded-xl border-2 ${assessmentBorderClass(
                          assessment?.label
                        )} p-2 text-left ${
                          isActive ? "bg-sky-50 ring-2 ring-sky-200" : "hover:shadow-sm"
                        }`}
                        onClick={() => setStudentSlideIndex(slide.index)}
                      >
                        <div className="text-xs font-semibold text-zinc-600">Problem {slide.index}</div>
                        <div
                          className={`mt-2 h-24 rounded-lg border-2 ${assessmentBorderClass(
                            assessment?.label
                          )} bg-zinc-50 overflow-hidden`}
                        >
                          {drawingPath ? (
                            <img
                              src={`${drawingPath}?v=${encodeURIComponent(cell?.updatedAt || "")}`}
                              alt={`Problem ${slide.index}`}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[11px] text-zinc-400">
                              No work
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <div
                className={`h-full rounded-2xl border-2 ${assessmentBorderClass(
                  selectedStudentActiveAssessment?.label
                )} bg-zinc-50 p-3 flex flex-col min-h-0`}
              >
                <div className="text-xs font-semibold uppercase text-zinc-500">
                  Live Work · Problem {studentSlideIndex}
                </div>
                {studentSummary && (
                  <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700 whitespace-pre-wrap">
                    {studentSummary}
                  </div>
                )}
                {summaryError && (
                  <div className="mt-2 text-xs text-red-500">{summaryError}</div>
                )}
                <div
                  className={`mt-2 flex-1 min-h-0 overflow-auto rounded-xl border-2 ${assessmentBorderClass(
                    selectedStudentActiveAssessment?.label
                  )} bg-white`}
                  onWheel={(e) => {
                    if (!e.ctrlKey && !e.metaKey) return;
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    setZoom((z) =>
                      Math.min(3, Math.max(0.5, Math.round((z + delta) * 10) / 10))
                    );
                  }}
                >
                  {(() => {
                    const slide = slides.find((s) => s.index === studentSlideIndex);
                    const cell = slide
                      ? responsesMap.get(`${selectedStudent.studentId}:${slide.id}`)
                      : undefined;
                    const drawingPath = cell?.drawingPath || "";
                    return drawingPath ? (
                      <div
                        className="h-full w-full"
                        style={{
                          transform: `scale(${zoom})`,
                          transformOrigin: "top left",
                        }}
                      >
                        <img
                          src={`${drawingPath}?v=${encodeURIComponent(cell?.updatedAt || "")}`}
                          alt="Student drawing"
                          className="h-full w-auto object-contain"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                        No drawing yet.
                      </div>
                    );
                  })()}
                </div>
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
