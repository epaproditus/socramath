"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload, CheckCircle2, XCircle, RefreshCw, Trash2 } from "lucide-react";
import { FEATURE_FLAGS } from "@/lib/config";

type LessonRow = {
  id: string;
  title: string;
  isActive: boolean;
  createdAt: string;
  sourceFilename?: string | null;
};

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export default function LessonBuilder() {
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [csvTitle, setCsvTitle] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);

  const canUpload = useMemo(() => !!file && !importing, [file, importing]);
  const canUploadCsv = useMemo(
    () => FEATURE_FLAGS.unifiedLessonCsvImport && !!csvFile && !csvImporting,
    [csvFile, csvImporting]
  );

  const loadLessons = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lessons");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLessons(data || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load lessons"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLessons();
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const form = new FormData();
      form.append("file", file);
      if (title.trim()) form.append("title", title.trim());

      const res = await fetch("/api/lesson-import", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const created = await res.json();
      setSuccess(`Lesson created: ${created.title}`);
      setTitle("");
      setFile(null);
      await loadLessons();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to import lesson"));
    } finally {
      setImporting(false);
    }
  };

  const handleCsvUpload = async () => {
    if (!csvFile || !FEATURE_FLAGS.unifiedLessonCsvImport) return;
    setCsvImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const form = new FormData();
      form.append("file", csvFile);
      if (csvTitle.trim()) form.append("title", csvTitle.trim());

      const res = await fetch("/api/lesson-import-csv", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const created = await res.json();
      setSuccess(`Lesson created from CSV: ${created.title}`);
      setCsvTitle("");
      setCsvFile(null);
      await loadLessons();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to import CSV lesson"));
    } finally {
      setCsvImporting(false);
    }
  };

  const setActiveLesson = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lessons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadLessons();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to set active lesson"));
    } finally {
      setLoading(false);
    }
  };

  const deleteLesson = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lessons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadLessons();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete lesson"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Lesson Builder</h1>
          <p className="text-sm text-zinc-500">
            Upload a PDF (exported from PowerPoint is fine). We will extract the text and
            use it as the active lesson for student tutoring.
          </p>
        </div>
        <a
          href="/teacher/lesson/session"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Open Live Session
        </a>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <label className="block text-sm font-medium">Lesson Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Civil War: Causes and Consequences"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            />
            <label className="block text-sm font-medium">PDF File</label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm"
            />
            {file && (
              <div className="text-xs text-zinc-500">Selected: {file.name}</div>
            )}
          </div>

          <div className="flex items-end">
            <button
              onClick={handleUpload}
              disabled={!canUpload}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              <Upload className="h-4 w-4" />
              {importing ? "Importing..." : "Create Lesson"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <XCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {success && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {success}
          </div>
        )}
      </div>

      {FEATURE_FLAGS.unifiedLessonCsvImport && (
        <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Import Unified Lesson From CSV</h2>
            <p className="text-sm text-zinc-500">
              Each CSV row becomes a slide with predefined blocks for prompt, response, and drawing.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <label className="block text-sm font-medium">Lesson Title (optional)</label>
              <input
                type="text"
                value={csvTitle}
                onChange={(e) => setCsvTitle(e.target.value)}
                placeholder="e.g. Unit 4 Review (CSV)"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
              />
              <label className="block text-sm font-medium">CSV File</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
              {csvFile && (
                <div className="text-xs text-zinc-500">Selected: {csvFile.name}</div>
              )}
            </div>
            <div className="flex items-end">
              <button
                onClick={handleCsvUpload}
                disabled={!canUploadCsv}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                <Upload className="h-4 w-4" />
                {csvImporting ? "Importing..." : "Create Lesson From CSV"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Existing Lessons</h2>
          <button
            onClick={loadLessons}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="space-y-2">
          {lessons.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
              No lessons yet. Upload a PDF above to create your first lesson.
            </div>
          )}

          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{lesson.title}</div>
                <div className="text-xs text-zinc-500">
                  {lesson.sourceFilename || "Uploaded lesson"} •{" "}
                  {new Date(lesson.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lesson.isActive ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Active
                  </span>
                ) : (
                  <button
                    className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setActiveLesson(lesson.id)}
                    disabled={loading}
                  >
                    Set Active
                  </button>
                )}
                <button
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  onClick={() => deleteLesson(lesson.id)}
                  disabled={loading}
                  title="Delete lesson"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
