"use client";

import { useEffect, useState } from "react";
import { getAppConfig, saveAppConfig, fetchModelList } from "@/app/actions";

export default function TeacherSettings() {
  const [configDraft, setConfigDraft] = useState({ baseUrl: "", apiKey: "", model: "", systemPrompt: "" });
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState<string | null>(null);

  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      setConfigDraft({
        baseUrl: data.baseUrl || "",
        apiKey: data.apiKey || "",
        model: data.model || "",
        systemPrompt: data.systemPrompt || "",
      });
    } catch (err) {
      setConfigError("Failed to load app config");
    }
  };

  const loadModels = async (baseUrl: string, apiKey: string) => {
    if (!baseUrl) return;
    try {
      setModelLoading(true);
      setConfigError(null);
      const models = await fetchModelList(baseUrl, apiKey);
      setModelOptions(models || []);
    } catch (err: any) {
      setModelOptions([]);
      setConfigError(err?.message || "Failed to fetch models");
    } finally {
      setModelLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">LLM Settings</h1>
        <p className="text-sm text-zinc-500">
          Configure your provider, API key, and preferred model.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-zinc-500">Base URL</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm"
              placeholder="https://api.openai.com"
              value={configDraft.baseUrl}
              onChange={(e) => setConfigDraft({ ...configDraft, baseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-zinc-500">API Key</label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm"
              placeholder="sk-..."
              value={configDraft.apiKey}
              onChange={(e) => setConfigDraft({ ...configDraft, apiKey: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-zinc-500">Global Prompt</label>
            <textarea
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm"
              placeholder="e.g. Keep answers concise, ask one question at a time."
              value={configDraft.systemPrompt}
              onChange={(e) => setConfigDraft({ ...configDraft, systemPrompt: e.target.value })}
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
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm"
              value={configDraft.model}
              onChange={(e) => setConfigDraft({ ...configDraft, model: e.target.value })}
            >
              <option value="">Select a model</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {configError && <p className="text-xs text-rose-500">{configError}</p>}
          {configSaved && <p className="text-xs text-emerald-600">{configSaved}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={loadConfig}
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200"
          >
            Reset
          </button>
          <button
            onClick={async () => {
              try {
                setConfigSaving(true);
                setConfigError(null);
                setConfigSaved(null);
                await saveAppConfig({
                  baseUrl: configDraft.baseUrl,
                  apiKey: configDraft.apiKey,
                  model: configDraft.model,
                  systemPrompt: configDraft.systemPrompt,
                });
                setConfigSaved("Saved.");
                setTimeout(() => setConfigSaved(null), 1500);
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
  );
}
