import { HelpCircle, ChevronDown, ChevronUp, Book, X } from "lucide-react";
import { useState, useEffect } from "react";
import Stack from "./Stack";
import { useAppStore } from "@/lib/store";

export const QuestionCard = ({ args }: { args?: any }) => {
    const [showVocab, setShowVocab] = useState(false);
    const {
        currentSession,
        activeQuestionId,
        setActiveQuestionId,
        setTutorUnlocked,
        setStudentResponse,
        markDoneUnlocked,
        setMarkDoneUnlocked,
        requestAdvance,
        requestSummary,
        requestNudge,
        studentGoalsByQuestion,
        goalProgressByQuestion,
        setStudentGoals,
        setGoalProgress,
    } = useAppStore();
    const [response, setResponse] = useState<any | null>(null);
    const [loadingResponse, setLoadingResponse] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showQuestionModal, setShowQuestionModal] = useState(false);
    const [editMode, setEditMode] = useState({
        difficulty: false,
        initialReasoning: false,
        confidence: false,
    });
    const [reasoningDraft, setReasoningDraft] = useState("");
    const [loadingGoals, setLoadingGoals] = useState(false);

    const safeArgs = args ?? {};
    const hasArgs = !!safeArgs.text;

    const currentQuestionIndex = (safeArgs.question_number || 1);
    const totalQuestions = (safeArgs.total_questions || 1);

    // Live Data Lookup (fallback to args if needed, but prefer store)
    const liveQuestion = currentSession.questions[currentQuestionIndex - 1];

    // Use Live Vocab or Args Vocab
    const vocabulary = liveQuestion?.vocabulary || safeArgs.vocabulary || [];
    const hasVocab = vocabulary.length > 0;
    const hasImage = !!safeArgs.image_url;

    const questionId = liveQuestion?.id;
    const sessionId = currentSession.id;
    const goalList = questionId ? studentGoalsByQuestion[questionId] || [] : [];
    const goalProgress = questionId ? goalProgressByQuestion[questionId] || [] : [];

    useEffect(() => {
        if (!questionId || !sessionId) return;

        if (questionId !== activeQuestionId) {
            setActiveQuestionId(questionId);
            setTutorUnlocked(false);
        }

        const load = async () => {
            try {
                setLoadingResponse(true);
                const res = await fetch(`/api/student-response?sessionId=${sessionId}&questionId=${questionId}`);
                if (res.ok) {
                    const data = await res.json();
                    setResponse(data);
                    if (data?.questionId) {
                        setStudentResponse(data.questionId, data);
                    }
                } else {
                    setResponse(null);
                }
            } catch {
                setResponse(null);
            } finally {
                setLoadingResponse(false);
            }
        };

        load();
    }, [questionId, sessionId, activeQuestionId, setActiveQuestionId, setTutorUnlocked]);

    useEffect(() => {
        if (
            response?.difficulty &&
            response?.initialReasoning &&
            response?.confidence &&
            questionId === activeQuestionId
        ) {
            setTutorUnlocked(true);
        }
    }, [response?.difficulty, response?.initialReasoning, response?.confidence, questionId, activeQuestionId, setTutorUnlocked]);

    useEffect(() => {
        setReasoningDraft(response?.initialReasoning || "");
    }, [response?.initialReasoning]);

    useEffect(() => {
        if (!questionId) return;
        const key = `student-rubric-${questionId}`;
        const cached = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                    setStudentGoals(questionId, parsed);
                    const cachedProgress = window.localStorage.getItem(`student-rubric-progress-${questionId}`);
                    if (cachedProgress) {
                        try {
                            const progress = JSON.parse(cachedProgress);
                            if (Array.isArray(progress)) {
                                progress.forEach((value, idx) => setGoalProgress(questionId, idx, !!value));
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
                return;
            } catch {
                // ignore
            }
        }
        const rubric = liveQuestion?.rubric || safeArgs.rubric || [];
        const rubricSignature = JSON.stringify(rubric);
        if (typeof window !== "undefined") {
            const storedSignature = window.localStorage.getItem(`student-rubric-source-${questionId}`);
            if (storedSignature && storedSignature !== rubricSignature) {
                window.localStorage.removeItem(`student-rubric-${questionId}`);
                window.localStorage.removeItem(`student-rubric-progress-${questionId}`);
            }
            window.localStorage.setItem(`student-rubric-source-${questionId}`, rubricSignature);
        }
        if (!rubric.length) return;
        setLoadingGoals(true);
        fetch("/api/rubric-simplify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rubric }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data.goals)) {
                    setStudentGoals(questionId, data.goals);
                }
            })
            .finally(() => setLoadingGoals(false));
    }, [questionId, response?.initialReasoning, safeArgs.rubric]);

    const saveResponse = async (partial: any) => {
        if (!questionId || !sessionId) return;
        try {
            setSaving(true);
            const res = await fetch("/api/student-response", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    questionId,
                    ...partial,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setResponse(data);
                if (data?.questionId) {
                    setStudentResponse(data.questionId, data);
                }
            }
        } finally {
            setSaving(false);
        }
    };

    const nextStep = !response?.difficulty
        ? "difficulty"
        : !response?.initialReasoning
            ? "initialReasoning"
            : !response?.confidence
                ? "confidence"
                : "done";

    // Prepare Cards for Stack
    const vocabCards = hasVocab ? vocabulary.map((v: any, i: number) => (
        <div key={i} className="w-full h-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center shadow-sm relative select-none overflow-hidden rounded-xl">

            {/* Split Layout: Image Top, Text Bottom */}
            {v.image_url ? (
                <>
                    <div className="h-1/2 w-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border-b border-zinc-100 dark:border-zinc-800">
                        <img src={v.image_url} alt={v.term} className="w-full h-full object-cover" />
                    </div>
                    <div className="h-1/2 w-full p-4 flex flex-col items-center justify-center bg-white dark:bg-zinc-900">
                        <h4 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1 font-serif">
                            {v.term}
                        </h4>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-3">
                            {v.definition}
                        </p>
                    </div>
                </>
            ) : (
                <div className="p-6 flex flex-col items-center justify-center h-full">
                    <div className="w-8 h-1 bg-indigo-500 rounded-full mb-4"></div>
                    <h4 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2 font-serif">
                        {v.term}
                    </h4>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug">
                        {v.definition}
                    </p>
                </div>
            )}

            <span className="absolute bottom-2 right-3 text-[10px] font-bold text-zinc-300 uppercase tracking-widest z-10">
                {i + 1} / {vocabulary.length}
            </span>
        </div>
    )) : [];

    if (!hasArgs) return null;

    return (
        <div className="my-3 w-full max-w-3xl mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm relative">
            {/* Header */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <HelpCircle className="w-4 h-4" />
                    <span className="text-[11px] font-bold tracking-wider uppercase">Question {currentQuestionIndex} / {totalQuestions}</span>
                </div>

                {hasVocab && (
                    <button
                        onClick={() => setShowVocab(!showVocab)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${showVocab ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'}`}
                    >
                        <Book className="w-3.5 h-3.5" />
                        {showVocab ? 'Hide Vocabulary' : 'View Vocabulary'}
                    </button>
                )}
            </div>

            {/* Vocabulary Overlay / Section */}
            {hasVocab && showVocab && (
                <div className="bg-zinc-50/80 dark:bg-black/20 border-b border-zinc-200 dark:border-zinc-800 p-4 flex flex-col items-center animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-sm">
                    <div className="w-[240px] h-[280px] relative">
                        <Stack
                            randomRotation={true}
                            sensitivity={150}
                            sendToBackOnClick={true}
                            cards={vocabCards}
                        />
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-3 uppercase tracking-widest">
                        Click cards to cycle
                    </p>
                </div>
            )}

            <div
                className={`p-4 ${hasImage ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : ''}`}
            >

                {/* Image Column */}
                {hasImage && (
                    <div className="flex flex-col gap-2">
                        <div
                            className="rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-black/20 flex items-center justify-center p-2 h-full min-h-[160px] max-h-[260px] cursor-zoom-in"
                            onClick={() => setShowQuestionModal(true)}
                        >
                            <img
                                src={safeArgs.image_url}
                                alt="Question Diagram"
                                className="max-w-full max-h-[240px] w-auto h-auto object-contain"
                            />
                        </div>
                        <p className="text-center text-[10px] text-zinc-400">Figure 1.1</p>
                    </div>
                )}

                {/* Text Column */}
                <div className="flex flex-col gap-4">
                    <div
                        className="prose dark:prose-invert prose-sm leading-relaxed text-zinc-800 dark:text-zinc-200 cursor-zoom-in"
                        onClick={() => setShowQuestionModal(true)}
                    >
                        {safeArgs.text}
                    </div>
                </div>

            </div>

            <div className="px-4 pb-4">
                <div className="bg-zinc-50 dark:bg-zinc-900/40 rounded-lg p-3 border border-zinc-200 dark:border-zinc-800 space-y-3">
                    <h3 className="text-[10px] font-bold uppercase text-zinc-500 mb-1 tracking-widest">
                        Test Review
                    </h3>

                    {loadingResponse && (
                        <p className="text-xs text-zinc-400">Loading your review...</p>
                    )}

                    {!loadingResponse && (
                        <div className="space-y-4">
                            {/* Difficulty */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase text-zinc-500">Difficulty</span>
                                    {response?.difficulty && !editMode.difficulty && (
                                        <button
                                            className="text-[10px] text-indigo-500 hover:underline"
                                            onClick={() => setEditMode({ ...editMode, difficulty: true })}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {response?.difficulty && !editMode.difficulty && (
                                    <div className="text-sm text-zinc-700 dark:text-zinc-300">
                                        Difficulty: <span className="font-semibold">{response.difficulty}</span> / 5
                                    </div>
                                )}
                                {(!response?.difficulty || editMode.difficulty) && (
                                    <div className="flex items-center gap-1.5">
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <button
                                                key={n}
                                                onClick={async () => {
                                                    await saveResponse({ difficulty: n });
                                                    setEditMode({ ...editMode, difficulty: false });
                                                }}
                                                className={`h-7 w-7 rounded-full text-[11px] font-semibold border ${response?.difficulty === n
                                                    ? "bg-indigo-600 text-white border-indigo-600"
                                                    : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                                                    }`}
                                                disabled={saving}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Initial Reasoning */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase text-zinc-500">How Would You Solve It?</span>
                                    {response?.initialReasoning && !editMode.initialReasoning && (
                                        <button
                                            className="text-[10px] text-indigo-500 hover:underline"
                                            onClick={() => setEditMode({ ...editMode, initialReasoning: true })}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                                {response?.initialReasoning && !editMode.initialReasoning && (
                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-3">
                                        {response.initialReasoning}
                                    </p>
                                )}
                                {(!response?.initialReasoning || editMode.initialReasoning) && (
                                    <div className="space-y-2">
                                        <textarea
                                            className="w-full h-16 p-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                                            placeholder="Explain your approach before seeing any answer..."
                                            value={reasoningDraft}
                                            onChange={(e) => setReasoningDraft(e.target.value)}
                                        />
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] text-zinc-400">Click submit to save.</p>
                                            <button
                                                className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                                                onClick={async () => {
                                                    const value = reasoningDraft.trim();
                                                    if (!value) return;
                                                    await saveResponse({ initialReasoning: value, forceSummarize: true });
                                                    setEditMode({ ...editMode, initialReasoning: false });
                                                    requestNudge("I finished the \"How would you solve it\" step.");
                                                }}
                                                disabled={saving}
                                            >
                                                Submit
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Confidence */}
                            {nextStep !== "difficulty" && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold uppercase text-zinc-500">Confidence</span>
                                        {response?.confidence && !editMode.confidence && (
                                            <button
                                                className="text-[10px] text-indigo-500 hover:underline"
                                                onClick={() => setEditMode({ ...editMode, confidence: true })}
                                            >
                                                Edit
                                            </button>
                                        )}
                                    </div>
                                    {response?.confidence && !editMode.confidence && (
                                        <div className="text-sm text-zinc-700 dark:text-zinc-300">
                                            Confidence: <span className="font-semibold">{response.confidence}</span> / 5
                                        </div>
                                    )}
                                    {(!response?.confidence || editMode.confidence) && (
                                        <div className="flex items-center gap-1.5">
                                            {[1, 2, 3, 4, 5].map((n) => (
                                                <button
                                                    key={n}
                                                    onClick={async () => {
                                                        await saveResponse({ confidence: n });
                                                        setEditMode({ ...editMode, confidence: false });
                                                    }}
                                                    className={`h-7 w-7 rounded-full text-[11px] font-semibold border ${response?.confidence === n
                                                        ? "bg-emerald-600 text-white border-emerald-600"
                                                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                                                        }`}
                                                    disabled={saving}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {goalList.length > 0 && (
                                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                                    <p className="text-[10px] font-bold uppercase text-zinc-500 mb-2">Goals For This Question</p>
                                    <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                                        {goalList.map((goal, idx) => {
                                            const done = goalProgress[idx];
                                            return (
                                            <li key={idx} className={`flex items-start gap-2 ${done ? "opacity-50" : ""}`}>
                                                <span className={`mt-1 h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-indigo-500"}`} />
                                                <span className={done ? "line-through" : ""}>{goal}</span>
                                            </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}
                            {loadingGoals && (
                                <p className="text-[10px] text-zinc-400">Loading goals…</p>
                            )}

                            {markDoneUnlocked && nextStep === "done" && (
                                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                                    <button
                                        className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
                                        onClick={async () => {
                                            await saveResponse({ forceSummarize: true });
                                            const currentIndex = currentSession.questions.findIndex((q) => q.id === questionId);
                                            const nextIndex = Math.min(currentSession.questions.length - 1, currentIndex + 1);
                                            const nextQuestion = currentSession.questions[nextIndex];
                                            if (nextQuestion?.id && nextQuestion.id !== questionId) {
                                                setTutorUnlocked(false);
                                                setMarkDoneUnlocked(false);
                                                requestSummary(questionId || null);
                                                requestAdvance(nextIndex + 1);
                                            }
                                        }}
                                    >
                                        Mark as Done → Next Question
                                    </button>
                                </div>
                            )}

                            {/* Revised Answer removed */}

                            {/* Summary hidden in student view */}
                        </div>
                    )}
                </div>
        </div>
        {showQuestionModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-xs font-semibold uppercase text-zinc-500">Question {currentQuestionIndex}</span>
                        <button
                            onClick={() => setShowQuestionModal(false)}
                            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            aria-label="Close"
                        >
                            <X className="w-4 h-4 text-zinc-500" />
                        </button>
                    </div>
                    <div className="p-6 overflow-y-auto space-y-4">
                        {hasImage && (
                            <div className="w-full flex items-center justify-center">
                                <img
                                    src={safeArgs.image_url}
                                    alt="Question Diagram"
                                    className="max-h-[60vh] w-auto object-contain"
                                />
                            </div>
                        )}
                        <div className="prose dark:prose-invert text-zinc-800 dark:text-zinc-200">
                            {safeArgs.text}
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
    );
};
