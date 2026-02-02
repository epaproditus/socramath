"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

export const QuestionTrigger = ({ args }: { args?: any }) => {
  const { currentSession, setActiveQuestionId, setTutorUnlocked, setSidebarOpen } = useAppStore();

  useEffect(() => {
    const questionNumber = args?.question_number || 1;
    const index = Math.max(0, questionNumber - 1);
    const question = currentSession.questions[index];
    if (question?.id) {
      setActiveQuestionId(question.id);
      setTutorUnlocked(false);
      setSidebarOpen(true);
    }
  }, [args?.question_number, currentSession.questions, setActiveQuestionId, setTutorUnlocked, setSidebarOpen]);

  return null;
};
