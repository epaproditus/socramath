"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

export const MarkDoneTrigger = ({ args }: { args?: any }) => {
  const { setMarkDoneUnlocked } = useAppStore();

  useEffect(() => {
    if (args?.question_number) {
      setMarkDoneUnlocked(true);
    }
  }, [args?.question_number, setMarkDoneUnlocked]);

  return null;
};
