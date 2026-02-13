export type LessonBlockType = "prompt" | "text" | "mcq" | "drawing";
export type LessonBlockRevealMode = "all" | "teacher";

type LessonBlockBase = {
  id: string;
  type: LessonBlockType;
  label?: string;
  required?: boolean;
};

export type LessonPromptBlock = LessonBlockBase & {
  type: "prompt";
  title?: string;
  content: string;
  required?: false;
};

export type LessonTextBlock = LessonBlockBase & {
  type: "text";
  label: string;
  placeholder?: string;
  required?: boolean;
  maxChars?: number;
};

export type LessonMcqBlock = LessonBlockBase & {
  type: "mcq";
  label: string;
  choices: string[];
  multi?: boolean;
  requireExplain?: boolean;
  required?: boolean;
};

export type LessonDrawingBlock = LessonBlockBase & {
  type: "drawing";
  label: string;
  required?: boolean;
};

export type LessonBlock =
  | LessonPromptBlock
  | LessonTextBlock
  | LessonMcqBlock
  | LessonDrawingBlock;

export type LessonResponseConfigV1 = {
  version: 1;
  blocks: LessonBlock[];
  sceneData?: Record<string, unknown>;
  widgets?: string[];
  blockRevealMode?: LessonBlockRevealMode;
  defaultVisibleBlockIds?: string[];
  [key: string]: unknown;
};

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback: number | undefined = undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeId = (raw: string, fallback: string) => {
  const value = raw.trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || fallback;
};

const makeBlockId = (type: LessonBlockType, idx: number) => `${type}_${idx + 1}`;

const sanitizeChoices = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => asString(item).trim())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
};

export const splitChoiceText = (value: string) =>
  value
    .split(/\r?\n|\||;/)
    .map((item) => item.trim())
    .filter(Boolean);

export const createPromptBlock = (content: string, title = "Prompt", id = "prompt_1"): LessonPromptBlock => ({
  id,
  type: "prompt",
  title,
  content: content.trim(),
  required: false,
});

export const createTextBlock = (
  label = "Your response",
  opts?: { id?: string; placeholder?: string; required?: boolean; maxChars?: number }
): LessonTextBlock => ({
  id: opts?.id || "text_1",
  type: "text",
  label,
  placeholder: opts?.placeholder || "Type your response...",
  required: opts?.required ?? true,
  maxChars: opts?.maxChars,
});

export const createMcqBlock = (
  label: string,
  choices: string[],
  opts?: { id?: string; multi?: boolean; requireExplain?: boolean; required?: boolean }
): LessonMcqBlock => ({
  id: opts?.id || "mcq_1",
  type: "mcq",
  label,
  choices: Array.from(new Set(choices.map((choice) => choice.trim()).filter(Boolean))),
  multi: opts?.multi ?? false,
  requireExplain: opts?.requireExplain ?? false,
  required: opts?.required ?? true,
});

export const createDrawingBlock = (
  label = "Show your work",
  opts?: { id?: string; required?: boolean }
): LessonDrawingBlock => ({
  id: opts?.id || "drawing_1",
  type: "drawing",
  label,
  required: opts?.required ?? false,
});

const sanitizeBlock = (input: unknown, idx: number): LessonBlock | null => {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const type = asString(source.type) as LessonBlockType;
  if (!["prompt", "text", "mcq", "drawing"].includes(type)) return null;
  const id = normalizeId(asString(source.id), makeBlockId(type, idx));

  if (type === "prompt") {
    const content = asString(source.content).trim();
    if (!content) return null;
    return {
      id,
      type,
      title: asString(source.title, "Prompt").trim() || "Prompt",
      content,
      required: false,
    };
  }

  if (type === "text") {
    return {
      id,
      type,
      label: asString(source.label, "Your response").trim() || "Your response",
      placeholder: asString(source.placeholder, "Type your response...") || "Type your response...",
      required: asBoolean(source.required, true),
      maxChars: asNumber(source.maxChars),
    };
  }

  if (type === "mcq") {
    const choices = sanitizeChoices(source.choices);
    if (!choices.length) return null;
    return {
      id,
      type,
      label: asString(source.label, "Choose one").trim() || "Choose one",
      choices,
      multi: asBoolean(source.multi, false),
      requireExplain: asBoolean(source.requireExplain, false),
      required: asBoolean(source.required, true),
    };
  }

  return {
    id,
    type,
    label: asString(source.label, "Show your work").trim() || "Show your work",
    required: asBoolean(source.required, false),
  };
};

const dedupeIds = (blocks: LessonBlock[]) => {
  const seen = new Set<string>();
  return blocks.map((block, idx) => {
    if (!seen.has(block.id)) {
      seen.add(block.id);
      return block;
    }
    const nextId = `${block.id}_${idx + 1}`;
    seen.add(nextId);
    return { ...block, id: nextId };
  });
};

const buildLegacyBlocks = (
  source: Record<string, unknown>,
  options?: { responseType?: string; prompt?: string }
): LessonBlock[] => {
  const blocks: LessonBlock[] = [];
  const prompt = asString(options?.prompt || source.prompt).trim();
  if (prompt) {
    blocks.push(createPromptBlock(prompt, "Prompt", "prompt_1"));
  }

  const choices = sanitizeChoices(source.choices);
  if (choices.length) {
    blocks.push(
      createMcqBlock(asString(source.label, "Choose your answer") || "Choose your answer", choices, {
        id: "mcq_1",
        multi: asBoolean(source.multi, false),
        requireExplain: asBoolean(source.explain, false),
        required: true,
      })
    );
  }

  const widgets = Array.isArray(source.widgets)
    ? source.widgets.map((widget) => asString(widget).toLowerCase()).filter(Boolean)
    : [];

  const responseType = asString(options?.responseType).toLowerCase();
  const shouldIncludeText =
    widgets.includes("text") ||
    responseType === "text" ||
    responseType === "both" ||
    (!choices.length && !widgets.includes("drawing"));
  const shouldIncludeDrawing =
    widgets.includes("drawing") || responseType === "drawing" || responseType === "both";

  if (shouldIncludeText) {
    blocks.push(createTextBlock("Your response", { id: "text_1", required: true }));
  }

  if (shouldIncludeDrawing) {
    blocks.push(createDrawingBlock("Show your work", { id: "drawing_1", required: false }));
  }

  if (!blocks.length) {
    blocks.push(createTextBlock("Your response", { id: "text_1", required: true }));
  }

  return dedupeIds(blocks);
};

export const normalizeLessonResponseConfig = (
  input: unknown,
  options?: { responseType?: string; prompt?: string }
): LessonResponseConfigV1 => {
  const source = input && typeof input === "object" ? ({ ...(input as Record<string, unknown>) } as Record<string, unknown>) : {};
  const maybeBlocks = Array.isArray(source.blocks) ? source.blocks : null;

  let blocks = maybeBlocks
    ? maybeBlocks
        .map((block, idx) => sanitizeBlock(block, idx))
        .filter((block): block is LessonBlock => !!block)
    : buildLegacyBlocks(source, options);

  if (!blocks.length) {
    blocks = [createTextBlock("Your response", { id: "text_1", required: true })];
  }

  blocks = dedupeIds(blocks);

  const normalized: LessonResponseConfigV1 = {
    ...source,
    version: 1,
    blocks,
  };

  if (source.sceneData && typeof source.sceneData === "object") {
    normalized.sceneData = source.sceneData as Record<string, unknown>;
  }

  if (Array.isArray(source.widgets)) {
    normalized.widgets = source.widgets
      .map((widget) => asString(widget).trim())
      .filter(Boolean);
  }

  const revealMode = asString(source.blockRevealMode).toLowerCase();
  if (revealMode === "teacher" || revealMode === "all") {
    normalized.blockRevealMode = revealMode as LessonBlockRevealMode;
  }
  if (Array.isArray(source.defaultVisibleBlockIds)) {
    const validIds = new Set(blocks.map((block) => block.id));
    normalized.defaultVisibleBlockIds = source.defaultVisibleBlockIds
      .map((id) => asString(id).trim())
      .filter((id) => !!id && validIds.has(id));
  }

  return normalized;
};

export const defaultPdfResponseConfig = ():
  LessonResponseConfigV1 => ({
    version: 1,
    blocks: [
      createTextBlock("Your response", {
        id: "text_1",
        placeholder: "Summarize this slide or solve the prompt...",
        required: true,
      }),
      createDrawingBlock("Show your work", { id: "drawing_1", required: false }),
    ],
    widgets: ["text", "drawing"],
  });

export const defaultCsvResponseConfig = (args: {
  prompt: string;
  choices?: string[];
  multi?: boolean;
  includeDrawing?: boolean;
  blockRevealMode?: LessonBlockRevealMode;
  startPromptOnly?: boolean;
}): LessonResponseConfigV1 => {
  const blocks: LessonBlock[] = [createPromptBlock(args.prompt || "", "Prompt", "prompt_1")];

  const choices = Array.from(new Set((args.choices || []).map((choice) => choice.trim()).filter(Boolean)));
  if (choices.length) {
    blocks.push(
      createMcqBlock("Choose your answer", choices, {
        id: "mcq_1",
        multi: !!args.multi,
        requireExplain: true,
        required: true,
      })
    );
  } else {
    blocks.push(
      createTextBlock("Your response", {
        id: "text_1",
        placeholder: "Explain your reasoning...",
        required: true,
      })
    );
  }

  if (args.includeDrawing !== false) {
    blocks.push(createDrawingBlock("Show your work", { id: "drawing_1", required: false }));
  }

  const blockRevealMode = args.blockRevealMode === "teacher" ? "teacher" : "all";
  const defaultVisibleBlockIds =
    blockRevealMode === "teacher"
      ? args.startPromptOnly === false
        ? blocks.map((block) => block.id)
        : blocks.filter((block) => block.type === "prompt").map((block) => block.id)
      : undefined;

  return {
    version: 1,
    blocks,
    widgets: choices.length
      ? args.includeDrawing === false
        ? ["choice"]
        : ["choice", "drawing"]
      : args.includeDrawing === false
      ? ["text"]
      : ["text", "drawing"],
    blockRevealMode,
    defaultVisibleBlockIds,
  };
};
