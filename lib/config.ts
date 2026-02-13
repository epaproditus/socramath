const parseFlag = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

const devDefault = process.env.NODE_ENV !== "production";

export const FEATURE_FLAGS = {
  unifiedLessonCsvImport: parseFlag(
    process.env.NEXT_PUBLIC_FEATURE_UNIFIED_LESSON_CSV_IMPORT,
    devDefault
  ),
  lessonBlockEditor: parseFlag(
    process.env.NEXT_PUBLIC_FEATURE_LESSON_BLOCK_EDITOR,
    devDefault
  ),
} as const;
