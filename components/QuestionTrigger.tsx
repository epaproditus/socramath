"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

export const QuestionTrigger = ({ args }: { args?: any }) => {
  const { currentSession, setActiveQuestionId, setTutorUnlocked, setSidebarOpen } = useAppStore();

  useEffect(() => {
    const questionNumber = args?.question_number || 1;
    const lockIndex = currentSession.studentLockIndex ?? currentSession.lockQuestionIndex ?? null;
    const maxAllowed = lockIndex ? Math.max(1, lockIndex) : null;
    const clampedNumber = maxAllowed ? Math.min(questionNumber, maxAllowed) : questionNumber;
    const index = Math.max(0, clampedNumber - 1);
    const question = currentSession.questions[index];
    if (question?.id) {
      setActiveQuestionId(question.id);
      setTutorUnlocked(false);
      setSidebarOpen(true);
      fetch("/api/student-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: currentSession.id,
          questionIndex: clampedNumber,
        }),
      }).catch(() => {});
    }
  }, [
    args?.question_number,
    currentSession.questions,
    currentSession.lockQuestionIndex,
    currentSession.studentLockIndex,
    setActiveQuestionId,
    setTutorUnlocked,
    setSidebarOpen,
  ]);

  return null;
};
