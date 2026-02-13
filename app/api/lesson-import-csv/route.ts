import { auth } from "@/auth";
import { defaultCsvResponseConfig, splitChoiceText } from "@/lib/lesson-blocks";
import prisma from "@/lib/prisma";
import Papa from "papaparse";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

type CsvRow = Record<string, string>;

type QuestionRow = {
  prompt: string;
  rubric: string[];
  choices: string[];
  multi: boolean;
  order: number;
};

type CsvParseResult = {
  data: CsvRow[];
  meta: { fields?: string[] };
  errors?: Array<Record<string, unknown>>;
};

type CanvasCtx = {
  measureText: (text: string) => { width: number };
  fillText: (text: string, x: number, y: number) => void;
};

const hasAnyValue = (row: CsvRow) =>
  Object.values(row || {}).some((value) => String(value || "").trim() !== "");

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const findHeader = (headers: string[], candidates: string[]) => {
  const normalizedHeaders = headers.map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const idx = normalizedHeaders.indexOf(normalizedCandidate);
    if (idx >= 0) return headers[idx];
  }
  return null;
};

const parseRubric = (raw: string) =>
  raw
    .split(/\r?\n|\||;/)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 12);

const parseBool = (raw: string) => {
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "multi", "multiple"].includes(normalized)) return true;
  return false;
};

const parseBooleanField = (
  value: FormDataEntryValue | null,
  defaultValue: boolean
) => {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
};

const readChoices = (row: CsvRow, headers: string[], explicitChoiceHeader: string | null) => {
  const optionHeaders = headers.filter((header) => /^(choice|option)\s*\d+$/i.test(header.trim()));
  const optionChoices = optionHeaders
    .map((header) => normalizeText(String(row[header] || "")))
    .filter(Boolean);

  const explicit = explicitChoiceHeader
    ? splitChoiceText(String(row[explicitChoiceHeader] || ""))
    : [];

  return Array.from(new Set([...optionChoices, ...explicit].map((choice) => normalizeText(choice)).filter(Boolean))).slice(0, 10);
};

const wrapText = (
  ctx: CanvasCtx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) => {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);

  lines.forEach((line, idx) => {
    ctx.fillText(line, x, y + idx * lineHeight);
  });
};

const buildSlideFilenames = (index: number, digits: number) => {
  const names = new Set<string>();
  names.add(`${index}.png`);
  names.add(`${String(index).padStart(digits, "0")}.png`);
  return Array.from(names);
};

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }

  const filename = file.name || "lesson.csv";
  if (!filename.toLowerCase().endsWith(".csv")) {
    return new Response("Please upload a CSV file", { status: 400 });
  }

  const csvText = await file.text();
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  }) as CsvParseResult;

  const headers = parsed.meta.fields || [];
  const rows = parsed.data.filter(hasAnyValue);
  if (!headers.length || !rows.length) {
    return new Response("CSV is empty", { status: 400 });
  }

  const promptHeader =
    findHeader(headers, ["prompt", "question", "question_text", "text", "item", "stem"]) ||
    headers[0];
  const rubricHeader = findHeader(headers, ["rubric", "criteria", "success_criteria"]);
  const choicesHeader = findHeader(headers, ["choices", "options", "answers", "answer_choices"]);
  const multiHeader = findHeader(headers, ["multi", "multiple", "is_multi", "multi_select"]);
  const orderHeader = findHeader(headers, ["order", "order_index", "index", "question_number"]);

  const questionRows: QuestionRow[] = rows
    .map((row: CsvRow, idx: number) => {
      const prompt = normalizeText(String(row[promptHeader] || ""));
      if (!prompt) return null;
      const rubric = rubricHeader ? parseRubric(String(row[rubricHeader] || "")) : [];
      const choices = readChoices(row, headers, choicesHeader);
      const multi = multiHeader ? parseBool(String(row[multiHeader] || "")) : false;
      const orderRaw = orderHeader ? Number(String(row[orderHeader] || "").trim()) : Number.NaN;
      const order = Number.isFinite(orderRaw) ? orderRaw : idx + 1;

      return { prompt, rubric, choices, multi, order };
    })
    .filter((row: QuestionRow | null): row is QuestionRow => !!row)
    .sort((a: QuestionRow, b: QuestionRow) => a.order - b.order);

  if (!questionRows.length) {
    return new Response("Could not detect question rows. Include a prompt/question column.", {
      status: 400,
    });
  }

  const titleValue = form.get("title");
  const includeDrawing = parseBooleanField(form.get("includeDrawing"), true);
  const teacherControlBlocks = parseBooleanField(form.get("teacherControlBlocks"), true);
  const startPromptOnly = parseBooleanField(form.get("startPromptOnly"), true);
  const lessonTitle =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim()
      : filename.replace(/\.[^.]+$/, "") || `Imported Lesson ${new Date().toLocaleDateString()}`;

  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    return new Response("Admin user not found. Log in once as admin.", { status: 400 });
  }

  const lessonContent = questionRows
    .map((row, idx) => `${idx + 1}. ${row.prompt}`)
    .join("\n");

  const lesson = await prisma.$transaction(async (tx) => {
    await tx.lesson.updateMany({
      where: { userId: adminUser.id, isActive: true },
      data: { isActive: false },
    });

    const created = await tx.lesson.create({
      data: {
        userId: adminUser.id,
        title: lessonTitle,
        content: lessonContent,
        sourceFilename: filename,
        pageCount: questionRows.length,
        isActive: true,
      },
    });

    for (const [idx, row] of questionRows.entries()) {
      await tx.lessonSlide.create({
        data: {
          lessonId: created.id,
          index: idx + 1,
          text: row.prompt,
          prompt: row.prompt,
          rubric: row.rubric.length ? JSON.stringify(row.rubric) : null,
          responseType: row.choices.length ? "both" : "text",
            responseConfig: JSON.stringify(
              defaultCsvResponseConfig({
                prompt: row.prompt,
                choices: row.choices,
                multi: row.multi,
                includeDrawing,
                blockRevealMode: teacherControlBlocks ? "teacher" : "all",
                startPromptOnly,
              })
            ),
          },
      });
    }

    return created;
  });

  const safeDir = path.join(process.cwd(), "public", "uploads", "lessons", lesson.id);
  const slidesDir = path.join(safeDir, "slides");
  await mkdir(slidesDir, { recursive: true });

  const { createCanvas } = await import("canvas");
  const width = 1280;
  const height = 720;
  const digits = String(Math.max(questionRows.length, 1)).length;

  await Promise.all(
    questionRows.map(async (row, idx) => {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 32px sans-serif";
      ctx.fillText(`Slide ${idx + 1}`, 64, 88);

      ctx.fillStyle = "#374151";
      ctx.font = "28px sans-serif";
      wrapText(ctx, row.prompt, 64, 150, width - 128, 40, 11);

      if (row.choices.length) {
        ctx.fillStyle = "#6b7280";
        ctx.font = "22px sans-serif";
        wrapText(
          ctx,
          `Choices: ${row.choices.join(" | ")}`,
          64,
          600,
          width - 128,
          30,
          3
        );
      }

      const buffer = canvas.toBuffer("image/png");
      const outputFilenames = buildSlideFilenames(idx + 1, digits);
      await Promise.all(
        outputFilenames.map((name) => writeFile(path.join(slidesDir, name), buffer))
      );
    })
  );

  return Response.json({
    id: lesson.id,
    title: lesson.title,
    content: lesson.content,
    pageCount: lesson.pageCount,
    pdfPath: lesson.pdfPath,
    isActive: lesson.isActive,
    createdAt: lesson.createdAt,
    source: "csv",
    importedSlides: questionRows.length,
    parseWarnings: parsed.errors || [],
  });
}
