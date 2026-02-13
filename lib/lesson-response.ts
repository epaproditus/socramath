import { LessonBlock, LessonMcqBlock } from "@/lib/lesson-blocks";

export type LessonBlockResponseEntry = {
  value?: string | string[];
  explain?: string;
  updatedAt: string;
};

export type LessonResponseJson = {
  version: 1;
  blocks: Record<string, LessonBlockResponseEntry>;
  meta?: {
    lastSubmittedAt?: string;
  };
};

export type LessonSlideCompletion = {
  requiredTotal: number;
  requiredDone: number;
  blockStatus: Record<string, boolean>;
};

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const nowIso = () => new Date().toISOString();

const normalizeValue = (value: unknown): string | string[] | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => asString(item).trim())
      .filter(Boolean);
    return normalized.length ? Array.from(new Set(normalized)) : undefined;
  }
  return undefined;
};

const normalizeEntry = (value: unknown): LessonBlockResponseEntry | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const normalizedValue = normalizeValue(source.value);
  const explain = asString(source.explain).trim();
  if (!normalizedValue && !explain) return null;
  return {
    value: normalizedValue,
    explain: explain || undefined,
    updatedAt: asString(source.updatedAt, nowIso()) || nowIso(),
  };
};

export const normalizeLessonResponseJson = (input: unknown): LessonResponseJson => {
  if (!input || typeof input !== "object") {
    return { version: 1, blocks: {} };
  }

  const source = input as Record<string, unknown>;
  const sourceBlocks =
    source.blocks && typeof source.blocks === "object"
      ? (source.blocks as Record<string, unknown>)
      : {};

  const normalizedBlocks: Record<string, LessonBlockResponseEntry> = {};
  for (const [blockId, entry] of Object.entries(sourceBlocks)) {
    const id = blockId.trim();
    if (!id) continue;
    const normalizedEntry = normalizeEntry(entry);
    if (!normalizedEntry) continue;
    normalizedBlocks[id] = normalizedEntry;
  }

  const output: LessonResponseJson = {
    version: 1,
    blocks: normalizedBlocks,
  };

  if (source.meta && typeof source.meta === "object") {
    const meta = source.meta as Record<string, unknown>;
    const lastSubmittedAt = asString(meta.lastSubmittedAt).trim();
    if (lastSubmittedAt) {
      output.meta = { lastSubmittedAt };
    }
  }

  return output;
};

export const parseLessonResponseJson = (raw: string | null | undefined): LessonResponseJson | null => {
  if (!raw || !raw.trim()) return null;
  try {
    return normalizeLessonResponseJson(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const stringifyLessonResponseJson = (input: unknown): string | null => {
  const normalized = normalizeLessonResponseJson(input);
  const hasBlocks = Object.keys(normalized.blocks).length > 0;
  const hasMeta = !!normalized.meta?.lastSubmittedAt;
  if (!hasBlocks && !hasMeta) return null;
  return JSON.stringify(normalized);
};

const blockIsRequired = (block: LessonBlock) => {
  if (block.type === "prompt") return false;
  return block.required !== false;
};

const hasValue = (entry?: LessonBlockResponseEntry | null) => {
  if (!entry) return false;
  if (typeof entry.value === "string") return entry.value.trim().length > 0;
  if (Array.isArray(entry.value)) return entry.value.length > 0;
  return false;
};

const mcqComplete = (block: LessonMcqBlock, entry?: LessonBlockResponseEntry | null) => {
  if (!entry) return false;
  const validSelection = block.multi
    ? Array.isArray(entry.value) && entry.value.length > 0
    : typeof entry.value === "string" && entry.value.trim().length > 0;

  if (!validSelection) return false;
  if (!block.requireExplain) return true;
  return !!entry.explain?.trim();
};

const textComplete = (entry?: LessonBlockResponseEntry | null) => hasValue(entry);

const drawingComplete = (entry?: LessonBlockResponseEntry | null, context?: { drawingPath?: string; drawingText?: string }) => {
  if (hasValue(entry)) return true;
  if (entry?.explain?.trim()) return true;
  if (context?.drawingPath && context.drawingPath.trim()) return true;
  if (context?.drawingText && context.drawingText.trim()) return true;
  return false;
};

const promptComplete = () => true;

export const computeLessonSlideCompletion = (args: {
  blocks: LessonBlock[];
  responseJson: LessonResponseJson | null;
  drawingPath?: string | null;
  drawingText?: string | null;
}): LessonSlideCompletion => {
  const status: Record<string, boolean> = {};
  let requiredTotal = 0;
  let requiredDone = 0;
  const blockMap = args.responseJson?.blocks || {};

  for (const block of args.blocks) {
    const entry = blockMap[block.id];
    let done = false;

    if (block.type === "prompt") done = promptComplete();
    if (block.type === "text") done = textComplete(entry);
    if (block.type === "mcq") done = mcqComplete(block, entry);
    if (block.type === "drawing") {
      done = drawingComplete(entry, {
        drawingPath: args.drawingPath || "",
        drawingText: args.drawingText || "",
      });
    }

    status[block.id] = done;
    if (blockIsRequired(block)) {
      requiredTotal += 1;
      if (done) requiredDone += 1;
    }
  }

  return {
    requiredTotal,
    requiredDone,
    blockStatus: status,
  };
};

const renderBlockValue = (block: LessonBlock, entry?: LessonBlockResponseEntry | null) => {
  if (!entry) return "";
  if (block.type === "mcq") {
    const selection =
      Array.isArray(entry.value) ? entry.value.join(", ") : typeof entry.value === "string" ? entry.value : "";
    const explain = entry.explain?.trim() ? ` | Explain: ${entry.explain.trim()}` : "";
    return `${selection}${explain}`.trim();
  }

  if (Array.isArray(entry.value)) return entry.value.join(", ");
  if (typeof entry.value === "string") return entry.value;
  if (entry.explain?.trim()) return entry.explain.trim();
  return "";
};

export const summarizeLessonResponseJson = (args: {
  blocks: LessonBlock[];
  responseJson: LessonResponseJson | null;
  fallbackText?: string | null;
  drawingPath?: string | null;
  drawingText?: string | null;
}): string => {
  const blockMap = args.responseJson?.blocks || {};
  const lines: string[] = [];

  for (const block of args.blocks) {
    if (block.type === "prompt") continue;
    const value = renderBlockValue(block, blockMap[block.id]);
    if (!value) continue;
    const label = block.label || block.type.toUpperCase();
    lines.push(`${label}: ${value}`);
  }

  if (!lines.length && args.fallbackText?.trim()) {
    lines.push(args.fallbackText.trim());
  }

  if (args.drawingText?.trim()) {
    lines.push(`Drawing Notes: ${args.drawingText.trim()}`);
  } else if (args.drawingPath?.trim()) {
    lines.push("Drawing submitted.");
  }

  return lines.join("\n").slice(0, 4000);
};

export const responseJsonToAssessmentText = (args: {
  blocks: LessonBlock[];
  responseJson: LessonResponseJson | null;
  fallbackText?: string | null;
  drawingPath?: string | null;
  drawingText?: string | null;
}) => summarizeLessonResponseJson(args);
