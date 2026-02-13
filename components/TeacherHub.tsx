"use client";

import Link from "next/link";
import { ArrowRight, FileText, BookOpen, Settings } from "lucide-react";

export default function TeacherHub() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Teacher Hub</h1>
        <p className="text-sm text-zinc-500">
          Create and manage different experiences for your students.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          href="/teacher/test-review"
          className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-3 text-indigo-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">Test Review (Legacy)</div>
              <div className="text-sm text-zinc-500">
                Legacy correction workflow for existing sessions.
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-indigo-700">
            Open Legacy Review <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </div>
        </Link>

        <Link
          href="/teacher/lesson"
          className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-3 text-amber-700">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">Lesson Builder (Unified)</div>
              <div className="text-sm text-zinc-500">
                Build paced lessons from PDF or CSV with live controls.
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-amber-700">
            Open Lesson Builder{" "}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </div>
        </Link>

        <Link
          href="/teacher/settings"
          className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-zinc-100 p-3 text-zinc-700">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">Settings</div>
              <div className="text-sm text-zinc-500">
                Configure your LLM provider and model.
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-zinc-700">
            Open Settings{" "}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </div>
        </Link>

      </div>
    </div>
  );
}
