"use client";

import { useAppStore } from "@/lib/store";
import { ArrowLeft, Sparkles, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TeacherDashboard() {
    const router = useRouter();
    const { currentSession, updateSessionTitle, updateQuestion, addQuestion, removeQuestion, setMode } = useAppStore();

    const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
    const activeQuestion = currentSession.questions[activeQuestionIndex];

    const handleRubricChange = (ruleIndex: number, value: string) => {
        if (!activeQuestion) return;
        const newCriteria = [...activeQuestion.rubric];
        newCriteria[ruleIndex] = value;
        updateQuestion(activeQuestionIndex, 'rubric', newCriteria);
    };

    const addCriterion = () => {
        if (!activeQuestion) return;
        updateQuestion(activeQuestionIndex, 'rubric', [...activeQuestion.rubric, ""]);
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
                    />
                </div>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
                    <Sparkles className="w-4 h-4" />
                    <span>Auto-Generate Tool (Beta)</span>
                </button>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar: Question List */}
                <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/50 flex flex-col">
                    <div className="p-4 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-zinc-500">Questions</span>
                        <button onClick={addQuestion} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded">
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
                    {activeQuestion ? (
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

                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold uppercase text-zinc-500">Student's Wrong Answer</label>
                                        <textarea
                                            className="w-full h-24 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none text-sm"
                                            value={activeQuestion.student_response}
                                            onChange={(e) => updateQuestion(activeQuestionIndex, 'student_response', e.target.value)}
                                            placeholder="What did they get wrong?"
                                        />
                                    </div>
                                </div>

                                {/* Right: Rubric & Vocab */}
                                <div className="space-y-6">
                                    <div className="space-y-4 bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold uppercase text-zinc-500">Rubric Criteria</label>
                                            <button onClick={addCriterion} className="text-xs text-indigo-500 font-medium hover:underline">+ Add Rule</button>
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
        </div>
    );
}
