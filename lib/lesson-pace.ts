import { LessonBlock, LessonResponseConfigV1 } from "@/lib/lesson-blocks";

export type LessonPaceConfig = {
  allowedSlides?: number[];
  revealedBlockIdsBySlide?: Record<string, string[]>;
};

const toUniqueNumberList = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) =>
          typeof item === "number"
            ? item
            : Number.parseInt(String(item || "").trim(), 10)
        )
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  ).sort((a, b) => a - b);
};

const toUniqueStringList = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
};

export const parseLessonPaceConfig = (input: unknown): LessonPaceConfig | null => {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const normalized: LessonPaceConfig = {};
  let hasValue = false;

  if (Object.prototype.hasOwnProperty.call(source, "allowedSlides")) {
    normalized.allowedSlides = toUniqueNumberList(source.allowedSlides);
    hasValue = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(source, "revealedBlockIdsBySlide") &&
    source.revealedBlockIdsBySlide &&
    typeof source.revealedBlockIdsBySlide === "object"
  ) {
    const mapSource = source.revealedBlockIdsBySlide as Record<string, unknown>;
    const normalizedMap: Record<string, string[]> = {};
    for (const [slideId, ids] of Object.entries(mapSource)) {
      const key = String(slideId || "").trim();
      if (!key) continue;
      normalizedMap[key] = toUniqueStringList(ids);
    }
    normalized.revealedBlockIdsBySlide = normalizedMap;
    hasValue = true;
  }

  return hasValue ? normalized : null;
};

export const mergeLessonPaceConfig = (
  current: LessonPaceConfig | null,
  incomingRaw: unknown
) => {
  const source =
    incomingRaw && typeof incomingRaw === "object"
      ? (incomingRaw as Record<string, unknown>)
      : null;
  const incoming = parseLessonPaceConfig(incomingRaw) || {};
  const merged: LessonPaceConfig = { ...(current || {}) };

  if (source && Object.prototype.hasOwnProperty.call(source, "allowedSlides")) {
    merged.allowedSlides = incoming.allowedSlides;
  }
  if (
    source &&
    Object.prototype.hasOwnProperty.call(source, "revealedBlockIdsBySlide")
  ) {
    merged.revealedBlockIdsBySlide = incoming.revealedBlockIdsBySlide;
  }

  if (
    !Object.prototype.hasOwnProperty.call(merged, "allowedSlides") &&
    !Object.prototype.hasOwnProperty.call(merged, "revealedBlockIdsBySlide")
  ) {
    return null;
  }

  return merged;
};

const defaultVisibleIds = (
  blocks: LessonBlock[],
  responseConfig?: LessonResponseConfigV1 | null
) => {
  const mode = responseConfig?.blockRevealMode || "all";
  if (mode !== "teacher") {
    return new Set(blocks.map((block) => block.id));
  }

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const configured = Array.isArray(responseConfig?.defaultVisibleBlockIds)
    ? responseConfig.defaultVisibleBlockIds.filter((id) => blockById.has(id))
    : [];

  if (configured.length) {
    return new Set(configured);
  }

  return new Set(
    blocks.filter((block) => block.type === "prompt").map((block) => block.id)
  );
};

export const resolveVisibleLessonBlocks = (args: {
  blocks: LessonBlock[];
  slideId?: string | null;
  paceConfig?: LessonPaceConfig | null;
  responseConfig?: LessonResponseConfigV1 | null;
}) => {
  const allBlocks = Array.isArray(args.blocks) ? args.blocks : [];
  if (!allBlocks.length) return [] as LessonBlock[];

  const byId = new Set(allBlocks.map((block) => block.id));
  let visible = defaultVisibleIds(allBlocks, args.responseConfig);

  const slideId = args.slideId ? String(args.slideId) : "";
  if (slideId) {
    const slideOverrides = args.paceConfig?.revealedBlockIdsBySlide?.[slideId];
    if (Array.isArray(slideOverrides)) {
      visible = new Set(slideOverrides.filter((id) => byId.has(id)));
    }
  }

  return allBlocks.filter(
    (block) => block.type === "prompt" || visible.has(block.id)
  );
};
