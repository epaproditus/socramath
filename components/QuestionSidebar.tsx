"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { QuestionCard } from "@/components/QuestionCard";

export const QuestionSidebar = () => {
  const { currentSession, activeQuestionId, sidebarOpen, setSidebarOpen, studentResponses } = useAppStore();

  const { question, index } = useMemo(() => {
    if (!currentSession.questions.length) {
      return { question: null, index: -1 };
    }

    if (!activeQuestionId) {
      return { question: currentSession.questions[0], index: 0 };
    }

    const foundIndex = currentSession.questions.findIndex((q) => q.id === activeQuestionId);
    if (foundIndex === -1) {
      return { question: currentSession.questions[0], index: 0 };
    }

    return { question: currentSession.questions[foundIndex], index: foundIndex };
  }, [currentSession.questions, activeQuestionId]);

  if (!question) return null;

  if (!sidebarOpen) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Question Panel</span>
        <button
          className="text-[11px] text-zinc-500 hover:text-indigo-600"
          onClick={() => setSidebarOpen(false)}
        >
          Hide
        </button>
      </div>
      {(currentSession.studentLockIndex || currentSession.lockQuestionIndex) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Pacing is on. You can’t go past question {currentSession.studentLockIndex ?? currentSession.lockQuestionIndex}.
        </div>
      )}
      <QuestionCard
        args={{
          question_number: index + 1,
          total_questions: currentSession.questions.length,
          text: question.text,
          image_url: question.image_url,
          student_response: studentResponses?.[question.id]?.originalAnswer || "",
          vocabulary: question.vocabulary,
        }}
      />
    </div>
  );
};
