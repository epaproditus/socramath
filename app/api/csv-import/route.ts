import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import Papa from "papaparse";


type NormalizedRow = {
  text: string;
  image_url?: string | null;
  student_response?: string | null;
  rubric?: string[];
  vocabulary?: { term: string; definition: string; image_url?: string }[];
  order_index?: number | null;
};

type LLMQuestionMapping = {
  text?: string | null;
  image_url?: string | null;
  student_response?: string | null;
  rubric?: string | null;
  vocabulary?: string | null;
  order_index?: string | null;
};

type LLMStudentMapping = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  local_id?: string | null;
};

type LLMQuestionColumn = {
  column: string;
  text?: string | null;
  order_index?: number | null;
};

type LLMMapResult = {
  mode?: "question_rows" | "student_rows";
  mapping?: LLMQuestionMapping;
  student_mapping?: LLMStudentMapping;
  question_columns?: LLMQuestionColumn[];
  metadata_row?: boolean;
  rows?: NormalizedRow[];
};

const KNOWN_METADATA_VALUES = new Set([
  "SingleResponse",
  "InlineText",
  "InlineChoice",
  "MultipleChoice",
  "MultiResponse",
  "OpenResponse",
  "Essay",
  "Numeric",
]);

const NON_QUESTION_HEADERS = new Set([
  "passed",
  "score",
  "points",
  "percent",
  "grade",
  "total",
]);

type QuestionGroup = {
  key: string;
  text: string;
  orderIndex: number;
  columns: LLMQuestionColumn[];
};

function isLikelyMetadataRow(
  row: Record<string, string>,
  questionColumns: string[]
) {
  if (!questionColumns.length) return false;
  let matches = 0;
  let total = 0;
  for (const col of questionColumns) {
    const value = String(row[col] || "").trim();
    if (!value) continue;
    total += 1;
    if (KNOWN_METADATA_VALUES.has(value)) matches += 1;
  }
  return total > 0 && matches / total >= 0.6;
}

function parseOrderIndexFromHeader(header: string) {
  const match = header.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
}

function normalizeQuestionText(header: string) {
  const trimmed = header.trim();
  if (!trimmed) return "Question";
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return `Question ${trimmed}`;
  }
  return trimmed;
}

function findHeader(headers: string[], candidates: string[]) {
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, ""));
  for (const candidate of candidates) {
    const target = candidate.toLowerCase().replace(/\s+/g, "");
    const idx = normalized.indexOf(target);
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function isLikelyQuestionHeader(header: string) {
  const trimmed = header.trim();
  if (!trimmed) return false;
  if (NON_QUESTION_HEADERS.has(trimmed.toLowerCase())) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return true;
  if (/^q\d+(\.\d+)?$/i.test(trimmed)) return true;
  if (/^question\s*\d+/i.test(trimmed)) return true;
  return false;
}

function baseQuestionKey(header: string) {
  const trimmed = header.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)$/);
  if (match) return match[1];
  return trimmed;
}

function normalizeLocalId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^0+/, "") || "0";
}

function buildQuestionGroups(columns: LLMQuestionColumn[]) {
  const groups = new Map<string, QuestionGroup>();
  columns.forEach((col, idx) => {
    const key = baseQuestionKey(col.column);
    const existing = groups.get(key);
    const orderIndex =
      typeof col.order_index === "number"
        ? col.order_index
        : parseOrderIndexFromHeader(col.column) ?? idx;
    if (existing) {
      existing.columns.push(col);
      return;
    }
    const text = col.text || normalizeQuestionText(key);
    groups.set(key, {
      key,
      text,
      orderIndex,
      columns: [col],
    });
  });
  return Array.from(groups.values()).sort((a, b) => a.orderIndex - b.orderIndex);
}

function joinPartAnswers(row: Record<string, string>, columns: LLMQuestionColumn[]) {
  if (columns.length === 1) {
    const raw = String(row[columns[0].column] || "").trim();
    return raw;
  }
  const parts = columns
    .map((col) => {
      const raw = String(row[col.column] || "").trim();
      if (!raw) return null;
      return `${col.column}: ${raw}`;
    })
    .filter(Boolean);
  return parts.join("\n");
}

async function mapCsvWithLLM(headers: string[], sampleRows: Record<string, string>[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API Key");
  }

  const system = `You are a CSV importer for a test review app.
Your job is to detect whether rows represent questions or students, then map columns accordingly.
Return ONLY valid JSON with this shape:
{
  "mode": "question_rows" | "student_rows",
  "mapping": {
    "text": "<column name or null>",
    "image_url": "<column name or null>",
    "student_response": "<column name or null>",
    "rubric": "<column name or null>",
    "vocabulary": "<column name or null>",
    "order_index": "<column name or null>"
  },
  "student_mapping": {
    "first_name": "<column name or null>",
    "last_name": "<column name or null>",
    "email": "<column name or null>",
    "local_id": "<column name or null>"
  },
  "question_columns": [
    { "column": "<column name>", "text": "<question text or null>", "order_index": 1 }
  ],
  "metadata_row": true | false,
  "rows": [
    {
      "text": "...",
      "image_url": "... or null",
      "student_response": "... or null",
      "rubric": ["..."],
      "vocabulary": [{"term":"...","definition":"...","image_url":"..."}],
      "order_index": 1
    }
  ]
}

Rules:
- If each CSV row is a student (columns like name/id and many question columns), choose "student_rows".
- If each CSV row is a question, choose "question_rows".
- For "student_rows", list all question columns and map student identifier columns.
- Set metadata_row=true if the first data row looks like question type metadata (e.g. "SingleResponse", "InlineText").
- For "question_rows", include "rows" with normalized questions.
- For question_columns, if no explicit question text exists, leave text null and we will label it.
- Keep outputs concise; do not invent content.
`;

  const user = JSON.stringify({
    headers,
    sample_rows: sampleRows,
  });

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";

  try {
    return JSON.parse(content) as LLMMapResult;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid LLM response");
    return JSON.parse(match[0]) as LLMMapResult;
  }
}

export async function POST(req: Request) {
  const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "preview";

  if (mode === "preview") {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new NextResponse("Missing file", { status: 400 });
    }

    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const parseErrors = parsed.errors || [];

    const headers = parsed.meta.fields || [];
    const rows = parsed.data.filter((r) =>
      Object.values(r || {}).some((v) => String(v || "").trim() !== "")
    );
    const sampleRows = rows.slice(0, 25);

    const mapped = await mapCsvWithLLM(headers, sampleRows);
    const mode = mapped.mode || "question_rows";

    if (mode === "student_rows") {
      const fallbackStudentMapping: LLMStudentMapping = {
        first_name:
          mapped.student_mapping?.first_name ||
          findHeader(headers, ["FirstName", "First Name", "GivenName"]),
        last_name:
          mapped.student_mapping?.last_name ||
          findHeader(headers, ["LastName", "Last Name", "Surname", "FamilyName"]),
        email:
          mapped.student_mapping?.email || findHeader(headers, ["Email", "EmailAddress"]),
        local_id:
          mapped.student_mapping?.local_id ||
          findHeader(headers, ["LocalID", "Local Id", "StudentID", "Student Id", "ID"]),
      };

      const studentColumns = new Set(
        Object.values(fallbackStudentMapping).filter((v): v is string => !!v)
      );

      const questionColumnsRaw =
        mapped.question_columns?.filter(
          (q) => headers.includes(q.column) && !NON_QUESTION_HEADERS.has(q.column.toLowerCase())
        ) || [];

      const questionColumns: LLMQuestionColumn[] = questionColumnsRaw.length
        ? questionColumnsRaw
        : headers
            .filter((h) => !studentColumns.has(h))
            .filter((h) => isLikelyQuestionHeader(h))
            .map((h) => ({ column: h, text: null, order_index: null }));

      const questionColumnNames = questionColumns.map((q) => q.column);
      let dataRows = rows;
      if (
        mapped.metadata_row ||
        (rows[0] && isLikelyMetadataRow(rows[0], questionColumnNames))
      ) {
        dataRows = rows.slice(1);
      }

      const sampleStudent = dataRows[0] || {};
      const groupedQuestions = buildQuestionGroups(questionColumns);
      const previewQuestions = groupedQuestions.map((group, idx) => ({
        text: group.text,
        image_url: null,
        student_response: joinPartAnswers(sampleStudent as Record<string, string>, group.columns),
        rubric: [],
        vocabulary: [],
        order_index: group.orderIndex ?? idx,
      }));

      return NextResponse.json({
        headers,
        mode,
        mapping: mapped,
        rows: previewQuestions,
        studentCount: dataRows.length,
        questionCount: groupedQuestions.length,
        errors: parseErrors,
      });
    }

    return NextResponse.json({
      headers,
      mode,
      mapping: mapped.mapping || {},
      rows: mapped.rows || [],
      errors: parseErrors,
    });
  }

  if (mode === "commit") {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      const sessionId = body?.sessionId as string | undefined;
      const rows = (body?.rows as NormalizedRow[]) || [];

      if (!sessionId) {
        return new NextResponse("Missing sessionId", { status: 400 });
      }

      const count = await prisma.question.count({
        where: { sessionId },
      });

      const createData = rows
        .filter((r) => r.text && r.text.trim())
        .map((r, i) => ({
          sessionId,
          text: r.text.trim(),
          imageUrl: r.image_url || null,
          studentResponse: r.student_response || "",
          rubric: JSON.stringify(r.rubric || []),
          vocabulary: JSON.stringify(r.vocabulary || []),
          orderIndex: typeof r.order_index === "number" ? r.order_index : count + i,
        }));

      if (!createData.length) {
        return new NextResponse("No rows to import", { status: 400 });
      }

      await prisma.$transaction(
        createData.map((data) => prisma.question.create({ data }))
      );

      const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId },
        include: { questions: { orderBy: { orderIndex: "asc" } } },
      });

      if (!dbSession) {
        return new NextResponse("Session not found", { status: 404 });
      }

      return NextResponse.json({
        id: dbSession.id,
        title: dbSession.title,
        studentProfile: null,
        questions: dbSession.questions.map((q) => ({
          id: q.id,
          text: q.text,
          student_response: q.studentResponse,
          image_url: q.imageUrl || undefined,
          rubric: JSON.parse(q.rubric || "[]"),
          vocabulary: JSON.parse(q.vocabulary || "[]"),
        })),
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    let sessionId = formData.get("sessionId") as string | null;
    const mappingRaw = formData.get("mapping") as string | null;
    const modeHint = formData.get("mode") as string | null;
    const createSession = formData.get("createSession") === "true";
    const sessionTitle = (formData.get("sessionTitle") as string | null) || null;

    if (!file) {
      return new NextResponse("Missing file", { status: 400 });
    }

    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const parseErrors = parsed.errors || [];

    const headers = parsed.meta.fields || [];
    const rows = parsed.data.filter((r) =>
      Object.values(r || {}).some((v) => String(v || "").trim() !== "")
    );

    let mapped: LLMMapResult | null = null;
    if (mappingRaw) {
      try {
        mapped = JSON.parse(mappingRaw) as LLMMapResult;
      } catch {
        mapped = null;
      }
    }

    if ((modeHint || mapped?.mode) !== "student_rows") {
      return new NextResponse("Unsupported commit mode", { status: 400 });
    }

    if (!sessionId && createSession) {
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;
      const ownerId = adminUser?.id || session.user.id;
      const fallbackTitle = sessionTitle || `Imported Session ${new Date().toLocaleDateString()}`;
      const created = await prisma.testSession.create({
        data: {
          userId: ownerId,
          title: fallbackTitle,
        },
      });
      sessionId = created.id;
    }

    if (!sessionId) {
      return new NextResponse("Missing sessionId", { status: 400 });
    }

    const fallbackStudentMapping: LLMStudentMapping = {
      first_name:
        mapped?.student_mapping?.first_name ||
        findHeader(headers, ["FirstName", "First Name", "GivenName"]),
      last_name:
        mapped?.student_mapping?.last_name ||
        findHeader(headers, ["LastName", "Last Name", "Surname", "FamilyName"]),
      email: mapped?.student_mapping?.email || findHeader(headers, ["Email", "EmailAddress"]),
      local_id:
        mapped?.student_mapping?.local_id ||
        findHeader(headers, ["LocalID", "Local Id", "StudentID", "Student Id", "ID"]),
    };

    const studentColumns = new Set(
      Object.values(fallbackStudentMapping).filter((v): v is string => !!v)
    );

    const questionColumnsRaw =
      mapped?.question_columns?.filter(
        (q) => headers.includes(q.column) && !NON_QUESTION_HEADERS.has(q.column.toLowerCase())
      ) || [];

    const questionColumns: LLMQuestionColumn[] = questionColumnsRaw.length
      ? questionColumnsRaw
      : headers
          .filter((h) => !studentColumns.has(h))
          .filter((h) => isLikelyQuestionHeader(h))
          .map((h) => ({ column: h, text: null, order_index: null }));

    if (!questionColumns.length) {
      return new NextResponse("No question columns detected", { status: 400 });
    }

    const questionColumnNames = questionColumns.map((q) => q.column);
    let dataRows = rows;
    if (
      mapped?.metadata_row ||
      (rows[0] && isLikelyMetadataRow(rows[0], questionColumnNames))
    ) {
      dataRows = rows.slice(1);
    }

    const studentRows = dataRows;

    const existingQuestions = await prisma.question.findMany({
      where: { sessionId },
      orderBy: { orderIndex: "asc" },
    });

    const questionByText = new Map(
      existingQuestions.map((q) => [q.text.trim().toLowerCase(), q])
    );

    const newQuestions: {
      sessionId: string;
      text: string;
      imageUrl: string | null;
      studentResponse: string;
      rubric: string;
      vocabulary: string;
      orderIndex: number;
    }[] = [];

    const groupedQuestions = buildQuestionGroups(questionColumns);
    groupedQuestions.forEach((group) => {
      const text = (group.text || normalizeQuestionText(group.key)).trim();
      const key = text.toLowerCase();
      const existing = questionByText.get(key);
      if (existing) return;

      newQuestions.push({
        sessionId,
        text,
        imageUrl: null,
        studentResponse: "",
        rubric: "[]",
        vocabulary: "[]",
        orderIndex: group.orderIndex,
      });
    });

    if (newQuestions.length) {
      await prisma.$transaction(
        newQuestions.map((data) => prisma.question.create({ data }))
      );
    }

    const finalQuestions = await prisma.question.findMany({
      where: { sessionId },
      orderBy: { orderIndex: "asc" },
    });

    const questionLookup = new Map(
      finalQuestions.map((q) => [q.text.trim().toLowerCase(), q])
    );

    const responseOps: Promise<any>[] = [];
    let skippedStudents = 0;
    const userByLocalId = new Map<string, { id: string }>();
    const userByEmail = new Map<string, { id: string }>();
    const usersWithLocalId = await prisma.user.findMany({
      where: { localId: { not: null } },
      select: { id: true, localId: true },
    });
    const userByNormalizedLocalId = new Map<string, { id: string }>();
    usersWithLocalId.forEach((u) => {
      if (!u.localId) return;
      userByLocalId.set(u.localId, { id: u.id });
      userByNormalizedLocalId.set(normalizeLocalId(u.localId), { id: u.id });
    });

    for (const row of studentRows) {
      const firstName = fallbackStudentMapping.first_name
        ? String(row[fallbackStudentMapping.first_name] || "").trim()
        : "";
      const lastName = fallbackStudentMapping.last_name
        ? String(row[fallbackStudentMapping.last_name] || "").trim()
        : "";
      const email = fallbackStudentMapping.email
        ? String(row[fallbackStudentMapping.email] || "").trim()
        : "";
      const localIdRaw = fallbackStudentMapping.local_id
        ? String(row[fallbackStudentMapping.local_id] || "").trim()
        : "";
      const localId = normalizeLocalId(localIdRaw);

      if (!firstName && !lastName && !email && !localId) {
        continue;
      }

      const name = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

      let user =
        (localId && userByLocalId.get(localId)) ||
        (localId && userByNormalizedLocalId.get(localId)) ||
        (email && userByEmail.get(email)) ||
        (email &&
          (await prisma.user.findUnique({
            where: { email },
          })));

      if (!user) {
        skippedStudents += 1;
        continue;
      }
      if (localId) userByLocalId.set(localId, user);
      if (email) userByEmail.set(email, user);

      for (const group of groupedQuestions) {
        const text = (group.text || normalizeQuestionText(group.key)).trim();
        const question = questionLookup.get(text.toLowerCase());
        if (!question) continue;

        const rawAnswer = joinPartAnswers(row, group.columns);
        if (!rawAnswer) continue;

        responseOps.push(
          prisma.studentResponse.upsert({
            where: {
              userId_sessionId_questionId: {
                userId: user.id,
                sessionId,
                questionId: question.id,
              },
            },
            update: {
              originalAnswer: rawAnswer,
            },
            create: {
              userId: user.id,
              sessionId,
              questionId: question.id,
              originalAnswer: rawAnswer,
            },
          })
        );
      }
    }

    if (responseOps.length) {
      await prisma.$transaction(responseOps);
    }

    const dbSession = await prisma.testSession.findFirst({
      where: { id: sessionId },
      include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    if (!dbSession) {
      return new NextResponse("Session not found", { status: 404 });
    }

    return NextResponse.json({
      id: dbSession.id,
      title: dbSession.title,
      studentProfile: null,
      questions: dbSession.questions.map((q) => ({
        id: q.id,
        text: q.text,
        student_response: q.studentResponse,
        image_url: q.imageUrl || undefined,
        rubric: JSON.parse(q.rubric || "[]"),
        vocabulary: JSON.parse(q.vocabulary || "[]"),
      })),
      importedStudents: studentRows.length,
      importedResponses: responseOps.length,
      skippedStudents,
      errors: parseErrors,
    });
  }

  return new NextResponse("Invalid mode", { status: 400 });
}
