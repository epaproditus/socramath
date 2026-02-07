"use client";

import { useAppStore } from "@/lib/store";
import { fetchSessionsList, fetchSessionById, fetchSessionAnswerMatrix, setActiveSession, deleteSessionAction, setAnswerKey, fetchSessionProgress, setSessionLock, setStudentLock, updateSessionTitleAction, getAppConfig, saveAppConfig, fetchModelList } from "@/app/actions";
import { ArrowLeft, Sparkles, Plus, Trash2, Upload, CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

export default function TeacherDashboard({ mode = "live" }: { mode?: "prep" | "live" }) {
    const router = useRouter();
    const { currentSession, updateSessionTitle, updateQuestion, addQuestion, removeQuestion, setMode, setSession, createSession } = useAppStore();

    const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
    const activeQuestion = currentSession.questions[activeQuestionIndex];
    const [answerMatrix, setAnswerMatrix] = useState<{
        questions: { id: string; text: string; key: string }[];
        groups: { classPeriod: string; questions: { questionId: string; text: string; key: string; suggestedAnswer?: string; suggestedCount?: number; correct: string[]; incorrect: string[]; missing: string[] }[] }[];
    } | null>(null);
    const [answerMatrixLoading, setAnswerMatrixLoading] = useState(false);
    const [progressData, setProgressData] = useState<{
        questions: { id: string; text: string; orderIndex: number }[];
        students: { id: string; name: string; classPeriod: string; localId?: string | null; lockQuestionIndex?: number | null; progress: Record<string, { status: string; originalAnswer: string; revisedAnswer: string; correctAnswer: string; summary?: string; }> }[];
        lockQuestionIndex: number | null;
    } | null>(null);
    const [progressLoading, setProgressLoading] = useState(false);
    const [editingAnswerKey, setEditingAnswerKey] = useState(false);
    const [answerKeyDraft, setAnswerKeyDraft] = useState("");
    const [rubricLoading, setRubricLoading] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const [previewRows, setPreviewRows] = useState<any[]>([]);
    const [previewMapping, setPreviewMapping] = useState<any | null>(null);
    const [previewMode, setPreviewMode] = useState<"question_rows" | "student_rows" | null>(null);
    const [importStats, setImportStats] = useState<{ studentCount?: number; questionCount?: number } | null>(null);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [createNewSession, setCreateNewSession] = useState(true);
    const [sessionTitle, setSessionTitle] = useState("");
    const [importError, setImportError] = useState<string | null>(null);
    const [importWarnings, setImportWarnings] = useState<string[]>([]);
    const [lastImportSummary, setLastImportSummary] = useState<{
        sessionTitle?: string;
        importedStudents?: number;
        importedResponses?: number;
        skippedStudents?: number;
    } | null>(null);
    const [sessions, setSessions] = useState<{ id: string; title: string; createdAt: string; isActive?: boolean }[]>([]);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [studentSummary, setStudentSummary] = useState<{
        totalQuestions: number;
        students: { id: string; name: string; email?: string | null; localId?: string | null; answers: number; missing: number }[];
    } | null>(null);
    const [studentSummaryLoading, setStudentSummaryLoading] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [configDraft, setConfigDraft] = useState({ baseUrl: "", apiKey: "", model: "" });
    const [modelOptions, setModelOptions] = useState<string[]>([]);
    const [modelLoading, setModelLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);

    const handleRubricChange = (ruleIndex: number, value: string) => {
        if (!activeQuestion) return;
        const newCriteria = [...activeQuestion.rubric];
        newCriteria[ruleIndex] = value;
        updateQuestion(activeQuestionIndex, 'rubric', newCriteria);
    };

    useEffect(() => {
        if (!currentSession.questions.length) {
            setActiveQuestionIndex(0);
            return;
        }
        if (activeQuestionIndex >= currentSession.questions.length) {
            setActiveQuestionIndex(0);
        }
    }, [activeQuestionIndex, currentSession.questions.length]);

    const loadSessions = async () => {
        try {
            setSessionLoading(true);
            const data = await fetchSessionsList();
            setSessions(
                data.map((s: any) => ({
                    id: s.id,
                    title: s.title,
                    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(s.createdAt).toISOString(),
                    isActive: s.isActive,
                }))
            );
            return data as { id: string }[];
        } catch (err) {
            console.error("Failed to load sessions", err);
            return [];
        } finally {
            setSessionLoading(false);
        }
    };

    const loadAnswerMatrix = async (sessionId: string) => {
        try {
            setAnswerMatrixLoading(true);
            const data = await fetchSessionAnswerMatrix(sessionId);
            setAnswerMatrix(data);
        } catch (err) {
            console.error("Failed to load answer matrix", err);
            setAnswerMatrix(null);
        } finally {
            setAnswerMatrixLoading(false);
        }
    };

    const loadProgress = async (sessionId: string) => {
        try {
            setProgressLoading(true);
            const data = await fetchSessionProgress(sessionId);
            setProgressData(data);
        } catch (err) {
            console.error("Failed to load progress data", err);
            setProgressData(null);
        } finally {
            setProgressLoading(false);
        }
    };

    useEffect(() => {
        (async () => {
            const list = await loadSessions();
            if (!list.length) return;
            const stillExists = list.some((s) => s.id === currentSession.id);
            if (!stillExists) {
                try {
                    const data = await fetchSessionById(list[0].id);
                    setSession(data);
                    loadAnswerMatrix(list[0].id);
                } catch (err) {
                    console.error("Failed to load fallback session", err);
                }
            }
        })();
    }, []);

    useEffect(() => {
        if (!currentSession?.id) return;
        if (sessions.length && !sessions.some((s) => s.id === currentSession.id)) return;
        loadAnswerMatrix(currentSession.id);
        loadProgress(currentSession.id);
    }, [currentSession?.id, sessions]);

    useEffect(() => {
        if (!answerMatrix?.questions?.length) return;
        const key = answerMatrix.questions[activeQuestionIndex]?.key || "";
        setAnswerKeyDraft(key);
    }, [answerMatrix?.questions, activeQuestionIndex]);

    const handleCsvPreview = async (file: File) => {
        setImportError(null);
        setPreviewRows([]);
        setPreviewMapping(null);
        setPreviewMode(null);
        setImportStats(null);
        setImportWarnings([]);
        setImporting(true);
        setUploadedFile(file);
        setSessionTitle(file?.name ? `Imported from ${file.name}` : "");
        setLastImportSummary(null);

        try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch("/api/csv-import?mode=preview", {
                method: "POST",
                body: form,
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || "Failed to parse CSV");
            }

            const data = await res.json();
            setPreviewRows(data.rows || []);
            setPreviewMapping(data.mapping || {});
            setPreviewMode(data.mode || "question_rows");
            setCreateNewSession((data.mode || "question_rows") === "student_rows");
            if (data.studentCount || data.questionCount) {
                setImportStats({
                    studentCount: data.studentCount,
                    questionCount: data.questionCount,
                });
            }
            if (data.errors?.length) {
                const warnings = data.errors.map((e: any) => e?.message || "CSV parse warning");
                setImportWarnings(warnings);
            }
        } catch (err: any) {
            setImportError(err?.message || "Failed to parse CSV");
        } finally {
            setImporting(false);
        }
    };

    const handleImportCommit = async () => {
        if (!previewRows.length) return;
        setImporting(true);
        setImportError(null);

        try {
            const isStudentImport = previewMode === "student_rows";
            if (isStudentImport && !uploadedFile) {
                throw new Error("Missing uploaded CSV file");
            }
            const res = await fetch("/api/csv-import?mode=commit", isStudentImport
                ? {
                    method: "POST",
                    body: (() => {
                        const form = new FormData();
                        if (uploadedFile) form.append("file", uploadedFile);
                        if (!createNewSession) {
                            form.append("sessionId", currentSession.id);
                        }
                        form.append("mode", "student_rows");
                        form.append("mapping", JSON.stringify(previewMapping || {}));
                        form.append("createSession", String(createNewSession));
                        if (sessionTitle) form.append("sessionTitle", sessionTitle);
                        return form;
                    })(),
                }
                : {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionId: currentSession.id,
                        rows: previewRows,
                    }),
                });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || "Import failed");
            }

            const data = await res.json();
            setSession(data);
            setLastImportSummary({
                sessionTitle: data?.title,
                importedStudents: data?.importedStudents,
                importedResponses: data?.importedResponses,
                skippedStudents: data?.skippedStudents,
            });
            setPreviewRows([]);
            setPreviewMapping(null);
            setPreviewMode(null);
            setImportStats(null);
            setUploadedFile(null);
            setImportWarnings([]);
            await loadSessions();
            await loadAnswerMatrix(data.id);
            setImportOpen(false);
        } catch (err: any) {
            setImportError(err?.message || "Import failed");
        } finally {
            setImporting(false);
        }
    };

    const addCriterion = () => {
        if (!activeQuestion) return;
        updateQuestion(activeQuestionIndex, 'rubric', [...activeQuestion.rubric, ""]);
    };

    const removeCriterion = (ruleIndex: number) => {
        if (!activeQuestion) return;
        const next = activeQuestion.rubric.filter((_, idx) => idx !== ruleIndex);
        updateQuestion(activeQuestionIndex, 'rubric', next);
    };

    const loadConfig = async () => {
        try {
            const data = await getAppConfig();
            setConfigDraft({
                baseUrl: data.baseUrl || "",
                apiKey: data.apiKey || "",
                model: data.model || "",
            });
        } catch (err) {
            console.error("Failed to load app config", err);
        }
    };

    const loadModels = async (baseUrl: string, apiKey: string) => {
        if (!baseUrl) return;
        try {
            setModelLoading(true);
            const models = await fetchModelList(baseUrl, apiKey);
            setModelOptions(models || []);
        } catch (err: any) {
            setModelOptions([]);
            setConfigError(err?.message || "Failed to fetch models");
        } finally {
            setModelLoading(false);
        }
    };


    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col">
            {/* Header */}
            <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => { setMode('student'); router.push('/'); }}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <input
                        className="text-lg font-bold bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-2"
                        value={currentSession.title}
                        onChange={(e) => updateSessionTitle(e.target.value)}
                        onBlur={async (e) => {
                            try {
                                await updateSessionTitleAction(currentSession.id, e.target.value);
                                loadSessions();
                            } catch (err) {
                                console.error("Failed to update session title", err);
                            }
                        }}
                    />
                </div>
                {mode === "prep" && (
                    <div className="flex items-center gap-2">
                        <Link
                            href="/teacher/settings"
                            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-200 text-zinc-700 hover:bg-zinc-100 rounded-lg text-sm font-medium transition-colors"
                        >
                            <span>Settings</span>
                        </Link>
                        <button
                            onClick={() => setImportOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg text-sm font-medium transition-colors"
                        >
                            <Upload className="w-4 h-4" />
                            <span>Import CSV</span>
                        </button>
                        <button
                            onClick={async () => {
                                await createSession("New Session");
                                loadSessions();
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Sparkles className="w-4 h-4" />
                            <span>New Session</span>
                        </button>
                    </div>
                )}
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar: Question List */}
                <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/50 flex flex-col">
                    <div className="p-4 flex flex-col gap-3 border-b border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase text-zinc-500">Sessions</span>
                        </div>
                        <select
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            value={currentSession.id}
                            onChange={async (e) => {
                                const nextId = e.target.value;
                                if (!nextId || nextId === currentSession.id) return;
                                try {
                                    const data = await fetchSessionById(nextId);
                                    setSession(data);
                                    loadAnswerMatrix(nextId);
                                } catch (err) {
                                    console.error("Failed to load session", err);
                                }
                            }}
                            disabled={sessionLoading || sessions.length === 0}
                        >
                            {sessions.length === 0 && (
                                <option value={currentSession.id}>Loading sessions...</option>
                            )}
                            {sessions.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.isActive ? "★ " : ""}{s.title}
                                </option>
                            ))}
                        </select>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={async () => {
                                    try {
                                        await setActiveSession(currentSession.id);
                                        await loadSessions();
                                    } catch (err) {
                                        console.error("Failed to set active session", err);
                                    }
                                }}
                                className="flex-1 text-[11px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            >
                                Set Active
                            </button>
                            <button
                                onClick={async () => {
                                    const ok = window.confirm("Delete this session? This cannot be undone.");
                                    if (!ok) return;
                                    try {
                                        const deleted = await deleteSessionAction(currentSession.id);
                                        if (!deleted) {
                                            console.error("Delete failed: session not found or not owned by user.");
                                            return;
                                        }
                                        const list = await fetchSessionsList();
                                        setSessions(
                                            list.map((s: any) => ({
                                                id: s.id,
                                                title: s.title,
                                                createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(s.createdAt).toISOString(),
                                                isActive: s.isActive,
                                            }))
                                        );
                                        const next = list[0];
                                        if (next?.id) {
                                            const data = await fetchSessionById(next.id);
                                            setSession(data);
                                            loadAnswerMatrix(next.id);
                                        }
                                    } catch (err) {
                                        console.error("Failed to delete session", err);
                                    }
                                }}
                                className="flex-1 text-[11px] px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                            >
                                Delete
                            </button>
                        </div>
                    </div>

                    <div className="p-4 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-zinc-500">Questions</span>
                        <button
                            onClick={addQuestion}
                            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded"
                            disabled={mode === "live"}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {currentSession.questions.map((q, idx) => (
                            <button
                                key={q.id}
                                onClick={() => setActiveQuestionIndex(idx)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${idx === activeQuestionIndex
                                    ? 'bg-white dark:bg-zinc-800 shadow-sm font-medium text-indigo-600 dark:text-indigo-400'
                                    : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                                    }`}
                            >
                                <span className="mr-2 opacity-50">#{idx + 1}</span>
                                {q.text || "New Question"}
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Main Content: Active Question Editor */}
                <main className="flex-1 overflow-y-auto p-8">
                    {mode === "live" && (
                    <div className="max-w-5xl mx-auto mb-8">
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-sm font-semibold uppercase text-zinc-500">Progress Grid</h2>
                                    <p className="text-xs text-zinc-400">Track where students are across questions.</p>
                                </div>
                                {progressLoading && (
                                    <span className="text-xs text-zinc-400">Loading...</span>
                                )}
                            </div>

                            {!progressLoading && progressData?.questions?.length ? (
                                <>
                                    <div className="flex items-center gap-3 text-xs text-zinc-600">
                                        <label className="flex items-center gap-2">
                                            Global lock:
                                            <select
                                                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-xs"
                                                value={progressData.lockQuestionIndex ?? 0}
                                                onChange={async (e) => {
                                                    const value = Number(e.target.value);
                                                    await setSessionLock(currentSession.id, value === 0 ? null : value);
                                                    loadProgress(currentSession.id);
                                                }}
                                            >
                                                <option value={0}>No lock</option>
                                                {progressData.questions.map((q, idx) => (
                                                    <option key={q.id} value={idx + 1}>Q{idx + 1}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <span className="text-[11px] text-zinc-400">Per-student overrides available per row.</span>
                                    </div>

                                    <div className="max-h-[420px] overflow-auto border border-zinc-200 dark:border-zinc-800 rounded-lg">
                                        <table className="w-full text-xs border-collapse">
                                            <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                                <tr>
                                                    <th className="text-left p-2 w-48">Student</th>
                                                    {progressData.questions.map((_, idx) => (
                                                        <th key={idx} className="text-center p-2 w-10">Q{idx + 1}</th>
                                                    ))}
                                                    <th className="text-center p-2 w-24">Lock</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(() => {
                                                    const grouped: Record<string, typeof progressData.students> = {};
                                                    progressData.students.forEach((s) => {
                                                        const key = s.classPeriod || "Unassigned";
                                                        if (!grouped[key]) grouped[key] = [];
                                                        grouped[key].push(s);
                                                    });
                                                    return Object.entries(grouped).map(([period, students]) => (
                                                        <Fragment key={`section-${period}`}>
                                                            <tr className="bg-zinc-50 dark:bg-zinc-950">
                                                                <td colSpan={progressData.questions.length + 2} className="p-2 text-[11px] font-semibold text-zinc-500 uppercase">
                                                                    {period}
                                                                </td>
                                                            </tr>
                                                            {students.map((s) => (
                                                                <tr key={s.id} className="border-t border-zinc-200 dark:border-zinc-800">
                                                                    <td className="p-2 text-zinc-700 dark:text-zinc-200">
                                                                        <div className="font-semibold">{s.name}</div>
                                                                        <div className="text-[10px] text-zinc-400">{s.localId || "No ID"}</div>
                                                                    </td>
                                                                    {progressData.questions.map((q, idx) => {
                                                                        const cell = s.progress[q.id];
                                                                        const status = cell?.status || "not_started";
                                                                        const hasKey = !!cell?.correctAnswer;
                                                                        const isCorrect = hasKey && cell.originalAnswer && cell.correctAnswer && cell.originalAnswer === cell.correctAnswer;
                                                                        const color =
                                                                            status === "completed"
                                                                                ? isCorrect ? "bg-emerald-500" : hasKey ? "bg-rose-500" : "bg-indigo-500"
                                                                                : status === "in_progress"
                                                                                    ? "bg-amber-400"
                                                                                    : "bg-zinc-300";
                                                                        return (
                                                                            <td key={q.id} className="p-2 text-center">
                                                                                <div className={`mx-auto h-3 w-3 rounded-full ${color}`} title={cell?.originalAnswer || ""} />
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td className="p-2 text-center">
                                                                        <select
                                                                            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-0.5 text-[10px]"
                                                                            value={s.lockQuestionIndex ?? 0}
                                                                            onChange={async (e) => {
                                                                                const value = Number(e.target.value);
                                                                                await setStudentLock(currentSession.id, s.id, value === 0 ? null : value);
                                                                                loadProgress(currentSession.id);
                                                                            }}
                                                                        >
                                                                            <option value={0}>—</option>
                                                                            {progressData.questions.map((_, idx) => (
                                                                                <option key={idx} value={idx + 1}>Q{idx + 1}</option>
                                                                            ))}
                                                                        </select>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </Fragment>
                                                    ));
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            ) : (
                                <p className="text-xs text-zinc-400">No progress data yet.</p>
                            )}
                        </div>
                    </div>
                    )}

                    {mode === "live" && (
                    <div className="max-w-5xl mx-auto mb-8">
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-sm font-semibold uppercase text-zinc-500">Question Focus</h2>
                                    <p className="text-xs text-zinc-400">Live status for the selected question.</p>
                                </div>
                            </div>

                            {progressData?.questions?.length ? (
                                (() => {
                                    const q = progressData.questions[activeQuestionIndex];
                                    if (!q) return <p className="text-xs text-zinc-400">No question selected.</p>;
                                    let completed = 0;
                                    let inProgress = 0;
                                    let notStarted = 0;
                                    let correct = 0;
                                    let incorrect = 0;
                                    progressData.students.forEach((s) => {
                                        const cell = s.progress[q.id];
                                        if (!cell) {
                                            notStarted += 1;
                                            return;
                                        }
                                        if (cell.status === "completed") completed += 1;
                                        else if (cell.status === "in_progress") inProgress += 1;
                                        else notStarted += 1;
                                        if (cell.correctAnswer) {
                                            if (cell.originalAnswer && cell.originalAnswer === cell.correctAnswer) correct += 1;
                                            else if (cell.originalAnswer) incorrect += 1;
                                        }
                                    });
                                    return (
                                        <div className="space-y-3">
                                            <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                                {q.text || `Question ${activeQuestionIndex + 1}`}
                                            </div>
                                            <div className="flex flex-wrap gap-2 text-xs">
                                                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Completed: {completed}</span>
                                                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">In progress: {inProgress}</span>
                                                <span className="px-2 py-1 rounded-full bg-zinc-200 text-zinc-600">Not started: {notStarted}</span>
                                                {correct + incorrect > 0 && (
                                                    <>
                                                        <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Correct: {correct}</span>
                                                        <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700">Incorrect: {incorrect}</span>
                                                    </>
                                                )}
                                            </div>
                                            <div className="max-h-[260px] overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
                                                {progressData.students.map((s) => {
                                                    const cell = s.progress[q.id];
                                                    if (!cell?.originalAnswer) return null;
                                                    return (
                                                        <div key={s.id} className="flex flex-col gap-1 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="text-zinc-700 dark:text-zinc-200">{s.name}</div>
                                                                <div className="text-zinc-500 dark:text-zinc-400 flex-1 text-right">{cell.originalAnswer}</div>
                                                            </div>
                                                            {cell.summary && (
                                                                <div className="text-[10px] text-zinc-400">
                                                                    {cell.summary}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {progressData.students.every((s) => !s.progress[q.id]?.originalAnswer) && (
                                                    <p className="text-zinc-400">No answers yet.</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()
                            ) : (
                                <p className="text-xs text-zinc-400">No progress data yet.</p>
                            )}
                        </div>
                    </div>
                    )}

                    {mode === "live" && (
                    <div className="max-w-5xl mx-auto mb-8">
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-sm font-semibold uppercase text-zinc-500">Answer Overview</h2>
                                    <p className="text-xs text-zinc-400">Grouped by class period, right vs wrong per problem.</p>
                                </div>
                                {answerMatrixLoading && (
                                    <span className="text-xs text-zinc-400">Loading...</span>
                                )}
                            </div>

                            {!answerMatrixLoading && answerMatrix?.groups?.length ? (
                                <div className="max-h-[520px] overflow-y-auto pr-1 space-y-4">
                                    {answerMatrix.groups.map((group) => (
                                        <div key={group.classPeriod} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                                            <div className="text-xs font-semibold uppercase text-zinc-500 mb-3">
                                                Class Period {group.classPeriod}
                                            </div>
                                            <div className="space-y-3">
                                                {group.questions
                                                    .filter((_, idx) => idx === activeQuestionIndex)
                                                    .map((q, idx) => (
                                                    <div key={q.questionId} className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                                                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                                                            Problem {activeQuestionIndex + 1}
                                                        </div>
                                                        <div className="text-[10px] text-zinc-400">
                                                            Answer key: {q.key || "—"}
                                                        </div>
                                                        {!q.key && q.suggestedAnswer && (
                                                            <div className="text-[10px] text-amber-700">
                                                                No key yet. Most selected: {q.suggestedAnswer} ({q.suggestedCount || 0})
                                                            </div>
                                                        )}
                                                        <div className="mt-2 flex items-center gap-2">
                                                            {!editingAnswerKey ? (
                                                                <button
                                                                    onClick={() => setEditingAnswerKey(true)}
                                                                    className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                                                                >
                                                                    Edit key
                                                                </button>
                                                            ) : (
                                                                <>
                                                                    <input
                                                                        className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-[11px]"
                                                                        value={answerKeyDraft}
                                                                        onChange={(e) => setAnswerKeyDraft(e.target.value)}
                                                                        placeholder="Enter answer key"
                                                                    />
                                                                    <button
                                                                        onClick={async () => {
                                                                            try {
                                                                                await setAnswerKey(currentSession.id, q.questionId, answerKeyDraft);
                                                                                await loadAnswerMatrix(currentSession.id);
                                                                                setEditingAnswerKey(false);
                                                                            } catch (err) {
                                                                                console.error("Failed to update answer key", err);
                                                                            }
                                                                        }}
                                                                        className="text-[10px] px-2 py-1 rounded bg-emerald-600 text-white"
                                                                    >
                                                                        Save
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingAnswerKey(false);
                                                                            setAnswerKeyDraft(q.key || "");
                                                                        }}
                                                                        className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-600"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap gap-1">
                                                            {q.correct.map((name) => (
                                                                <span key={`c-${name}`} className="px-2 py-1 rounded-full text-[10px] bg-emerald-100 text-emerald-700">
                                                                    {name}
                                                                </span>
                                                            ))}
                                                            {q.incorrect.map((name) => (
                                                                <span key={`i-${name}`} className="px-2 py-1 rounded-full text-[10px] bg-rose-100 text-rose-700">
                                                                    {name}
                                                                </span>
                                                            ))}
                                                            {q.missing.map((name) => (
                                                                <span key={`m-${name}`} className="px-2 py-1 rounded-full text-[10px] bg-zinc-200 text-zinc-600">
                                                                    {name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-zinc-400">No answers yet for this session.</p>
                            )}
                        </div>
                    </div>
                    )}

                    {mode === "prep" && activeQuestion ? (
                        <div className="max-w-3xl mx-auto space-y-8">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-semibold">Question #{activeQuestionIndex + 1}</h2>
                                <button
                                    onClick={() => {
                                        removeQuestion(activeQuestionIndex);
                                        setActiveQuestionIndex(Math.max(0, activeQuestionIndex - 1));
                                    }}
                                    className="text-red-500 hover:text-red-700 p-2"
                                    title="Delete Question"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Left: Content */}
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-zinc-500">Problem Text</label>
                                        <textarea
                                            className="w-full h-32 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none text-sm"
                                            value={activeQuestion.text}
                                            onChange={(e) => updateQuestion(activeQuestionIndex, 'text', e.target.value)}
                                            placeholder="e.g. Find the derivative..."
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-zinc-500">Image URL (Optional)</label>
                                        <input
                                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            value={activeQuestion.image_url || ''}
                                            onChange={(e) => updateQuestion(activeQuestionIndex, 'image_url', e.target.value)}
                                            placeholder="https://..."
                                        />
                                        {activeQuestion.image_url && (
                                            <div className="mt-2 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 h-32 w-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
                                                <img src={activeQuestion.image_url} alt="Preview" className="h-full object-contain" />
                                            </div>
                                        )}
                                    </div>

                                    {/* student wrong answer handled per-student, not per-question */}
                                </div>

                                {/* Right: Rubric & Vocab */}
                                <div className="space-y-6">
                                    <div className="space-y-4 bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold uppercase text-zinc-500">Rubric Criteria</label>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={async () => {
                                                        if (!activeQuestion?.text?.trim()) return;
                                                        try {
                                                            setRubricLoading(true);
                                                            const res = await fetch("/api/rubric-generate", {
                                                                method: "POST",
                                                                headers: { "Content-Type": "application/json" },
                                                                body: JSON.stringify({ question: activeQuestion.text }),
                                                            });
                                                            if (res.ok) {
                                                                const data = await res.json();
                                                                if (Array.isArray(data.rubric)) {
                                                                    updateQuestion(activeQuestionIndex, 'rubric', data.rubric);
                                                                }
                                                            }
                                                        } finally {
                                                            setRubricLoading(false);
                                                        }
                                                    }}
                                                    className="text-xs text-indigo-500 font-medium hover:underline"
                                                    disabled={rubricLoading || !activeQuestion?.text?.trim()}
                                                >
                                                    {rubricLoading ? "Generating..." : "Generate"}
                                                </button>
                                                <button onClick={addCriterion} className="text-xs text-indigo-500 font-medium hover:underline">+ Add Rule</button>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            {activeQuestion.rubric.map((rule, idx) => (
                                                <div key={idx} className="flex gap-2 items-center">
                                                    <span className="text-zinc-400 font-mono text-xs w-4">{idx + 1}.</span>
                                                    <input
                                                        className="flex-1 bg-zinc-100 dark:bg-zinc-800/50 border-none rounded px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                                        value={rule}
                                                        onChange={(e) => handleRubricChange(idx, e.target.value)}
                                                    />
                                                    <button
                                                        onClick={() => removeCriterion(idx)}
                                                        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-rose-500"
                                                        aria-label="Remove rubric item"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-4 bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold uppercase text-zinc-500">Vocabulary Deck</label>
                                            <button
                                                onClick={() => {
                                                    const currentVocab = activeQuestion.vocabulary || [];
                                                    updateQuestion(activeQuestionIndex, 'vocabulary', [...currentVocab, { term: "", definition: "" }]);
                                                }}
                                                className="text-xs text-amber-500 font-medium hover:underline"
                                            >
                                                + Add Card
                                            </button>
                                        </div>
                                        <div className="space-y-3">
                                            {(activeQuestion.vocabulary || []).map((card, idx) => (
                                                <div key={idx} className="flex gap-2 items-start p-2 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
                                                    <div className="flex-1 space-y-1">
                                                        <div className="flex gap-2">
                                                            <input
                                                                placeholder="Term"
                                                                className="flex-1 bg-transparent border-b border-zinc-200 dark:border-zinc-700 text-sm font-semibold focus:outline-none"
                                                                value={card.term}
                                                                onChange={(e) => {
                                                                    const newVocab = [...(activeQuestion.vocabulary || [])];
                                                                    newVocab[idx].term = e.target.value;
                                                                    updateQuestion(activeQuestionIndex, 'vocabulary', newVocab);
                                                                }}
                                                            />
                                                            <input
                                                                placeholder="Image URL (opt)"
                                                                className="w-1/3 bg-transparent border-b border-zinc-200 dark:border-zinc-700 text-xs font-mono focus:outline-none text-zinc-500"
                                                                value={card.image_url || ''}
                                                                onChange={(e) => {
                                                                    const newVocab = [...(activeQuestion.vocabulary || [])];
                                                                    newVocab[idx].image_url = e.target.value;
                                                                    updateQuestion(activeQuestionIndex, 'vocabulary', newVocab);
                                                                }}
                                                            />
                                                        </div>
                                                        <textarea
                                                            placeholder="Definition..."
                                                            className="w-full bg-transparent text-xs text-zinc-500 resize-none focus:outline-none"
                                                            rows={2}
                                                            value={card.definition}
                                                            onChange={(e) => {
                                                                const newVocab = [...(activeQuestion.vocabulary || [])];
                                                                newVocab[idx].definition = e.target.value;
                                                                updateQuestion(activeQuestionIndex, 'vocabulary', newVocab);
                                                            }}
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const newVocab = (activeQuestion.vocabulary || []).filter((_, i) => i !== idx);
                                                            updateQuestion(activeQuestionIndex, 'vocabulary', newVocab);
                                                        }}
                                                        className="text-zinc-400 hover:text-red-500"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {(!activeQuestion.vocabulary || activeQuestion.vocabulary.length === 0) && (
                                                <p className="text-xs text-zinc-400 italic">No vocabulary cards added.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                            <p>No questions selected.</p>
                            <button onClick={addQuestion} className="mt-4 text-indigo-500 hover:underline">Create one</button>
                        </div>
                    )}
                </main>
            </div>

            {mode === "prep" && importOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl">
                        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                            <div>
                                <h3 className="text-sm font-semibold uppercase text-zinc-500">Import CSV</h3>
                                <p className="text-xs text-zinc-400">First data row is treated as the answer key.</p>
                            </div>
                            <button
                                onClick={() => setImportOpen(false)}
                                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer">
                                <Upload className="w-4 h-4" />
                                <span>Choose CSV</span>
                                <input
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleCsvPreview(file);
                                    }}
                                />
                            </label>

                            {importing && (
                                <p className="text-xs text-zinc-500">Parsing and mapping columns…</p>
                            )}

                            {importError && (
                                <p className="text-xs text-red-500">{importError}</p>
                            )}

                            {importWarnings.length > 0 && (
                                <div className="text-xs text-amber-600 space-y-1">
                                    {importWarnings.slice(0, 3).map((w, idx) => (
                                        <p key={idx}>CSV warning: {w}</p>
                                    ))}
                                </div>
                            )}

                            {previewRows.length > 0 && (
                                <div className="space-y-3">
                                    {previewMode === "student_rows" && (
                                        <div className="flex flex-col gap-2 text-xs text-zinc-600">
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={createNewSession}
                                                    onChange={(e) => setCreateNewSession(e.target.checked)}
                                                />
                                                Create new session from this CSV
                                            </label>
                                            {createNewSession && (
                                                <input
                                                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                    value={sessionTitle}
                                                    onChange={(e) => setSessionTitle(e.target.value)}
                                                    placeholder="Session title"
                                                />
                                            )}
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-zinc-500">
                                            Previewing {Math.min(10, previewRows.length)} of {previewRows.length} rows
                                            {importStats?.studentCount ? ` | Students: ${importStats.studentCount}` : ""}
                                            {importStats?.questionCount ? ` | Questions: ${importStats.questionCount}` : ""}
                                        </p>
                                        <button
                                            onClick={handleImportCommit}
                                            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                                            disabled={importing}
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            {previewMode === "student_rows"
                                                ? `Import ${importStats?.studentCount || 0} Students`
                                                : `Import ${previewRows.length} Questions`}
                                        </button>
                                    </div>
                                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                                        <table className="w-full text-xs">
                                            <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                                <tr>
                                                    <th className="text-left p-2">Question</th>
                                                    <th className="text-left p-2">Sample Answer</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {previewRows.slice(0, 10).map((row, idx) => (
                                                    <tr key={idx} className="border-t border-zinc-200 dark:border-zinc-800">
                                                        <td className="p-2 text-zinc-700 dark:text-zinc-200">
                                                            {row.text || "(missing)"}
                                                        </td>
                                                        <td className="p-2 text-zinc-600 dark:text-zinc-400">
                                                            {row.student_response || "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {lastImportSummary && (
                                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                                    <p className="font-semibold">Last import complete</p>
                                    <p>Session: {lastImportSummary.sessionTitle || "Imported session"}</p>
                                    {typeof lastImportSummary.importedStudents === "number" && (
                                        <p>Students matched: {lastImportSummary.importedStudents}</p>
                                    )}
                                    {typeof lastImportSummary.importedResponses === "number" && (
                                        <p>Responses imported: {lastImportSummary.importedResponses}</p>
                                    )}
                                    {typeof lastImportSummary.skippedStudents === "number" && (
                                        <p>Students skipped (no match): {lastImportSummary.skippedStudents}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {settingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                        <div>
                            <h3 className="text-sm font-semibold">LLM Settings</h3>
                            <p className="text-xs text-zinc-500">Set your base URL and API key to fetch available models.</p>
                        </div>
                        <button
                            onClick={() => setSettingsOpen(false)}
                            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase text-zinc-500">Base URL</label>
                            <input
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
                                placeholder="https://api.openai.com"
                                value={configDraft.baseUrl}
                                onChange={(e) => setConfigDraft({ ...configDraft, baseUrl: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase text-zinc-500">API Key</label>
                            <input
                                type="password"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
                                placeholder="sk-..."
                                value={configDraft.apiKey}
                                onChange={(e) => setConfigDraft({ ...configDraft, apiKey: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold uppercase text-zinc-500">Model</label>
                                <button
                                    onClick={() => loadModels(configDraft.baseUrl, configDraft.apiKey)}
                                    className="text-[11px] text-indigo-500 hover:underline"
                                    disabled={modelLoading}
                                >
                                    {modelLoading ? "Loading..." : "Fetch models"}
                                </button>
                            </div>
                            <select
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
                                value={configDraft.model}
                                onChange={(e) => setConfigDraft({ ...configDraft, model: e.target.value })}
                            >
                                <option value="">Select a model</option>
                                {modelOptions.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                        {configError && (
                            <p className="text-xs text-rose-500">{configError}</p>
                        )}
                    </div>
                    <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                        <button
                            onClick={() => setSettingsOpen(false)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={async () => {
                                try {
                                    setConfigSaving(true);
                                    setConfigError(null);
                                    await saveAppConfig({
                                        baseUrl: configDraft.baseUrl,
                                        apiKey: configDraft.apiKey,
                                        model: configDraft.model,
                                    });
                                    setSettingsOpen(false);
                                } catch (err: any) {
                                    setConfigError(err?.message || "Failed to save settings");
                                } finally {
                                    setConfigSaving(false);
                                }
                            }}
                            className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                            disabled={configSaving}
                        >
                            {configSaving ? "Saving..." : "Save"}
                        </button>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
}
