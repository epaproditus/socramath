import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  contents.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

const envDefault = path.resolve(process.cwd(), ".env");
const envLocal = path.resolve(process.cwd(), ".env.local");
loadEnvFile(envDefault);
loadEnvFile(envLocal);

const prisma = new PrismaClient();

const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

if (!API_KEY) {
  console.error("Missing DEEPSEEK_API_KEY in environment.");
  process.exit(1);
}

const systemPrompt = `You summarize a student's work on a math question for a teacher.
Return 2-4 sentences, concise. Focus on misconception, progress, and what they understand.
Do not reveal the final answer. Do not mention transcripts.`;

async function summarize(payload) {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: payload },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

function buildPayload(r) {
  const parts = [];
  if (r.difficulty) parts.push(`Difficulty: ${r.difficulty}/5.`);
  if (r.confidence) parts.push(`Confidence: ${r.confidence}/5.`);
  if (r.initialReasoning) parts.push(`Initial reasoning: ${r.initialReasoning}`);
  if (r.originalAnswer) parts.push(`Original answer: ${r.originalAnswer}`);
  return parts.join("\n").trim();
}

function buildDeterministicSummary(r) {
  const parts = [];
  if (r.initialReasoning) {
    parts.push(`Student explained their approach: ${r.initialReasoning}`);
  }
  if (r.originalAnswer) {
    parts.push(`Original answer recorded as ${r.originalAnswer}.`);
  }
  if (r.difficulty || r.confidence) {
    const bits = [];
    if (r.difficulty) bits.push(`difficulty ${r.difficulty}/5`);
    if (r.confidence) bits.push(`confidence ${r.confidence}/5`);
    parts.push(`Self-rating: ${bits.join(", ")}.`);
  }
  if (!parts.length) return "";
  return parts.join(" ").slice(0, 380);
}

async function main() {
  const responses = await prisma.studentResponse.findMany({
    where: {
      OR: [{ summary: null }, { summary: "" }],
    },
  });

  console.log(`Found ${responses.length} responses missing summary.`);

  const concurrency = 3;
  let index = 0;

  async function worker() {
    while (index < responses.length) {
      const currentIndex = index++;
      const r = responses[currentIndex];
      const payload = buildPayload(r);
      if (!payload) {
        await prisma.studentResponse.update({
          where: { id: r.id },
          data: { summary: "" },
        });
        continue;
      }
      try {
        const summary = await summarize(payload);
        await prisma.studentResponse.update({
          where: { id: r.id },
          data: { summary },
        });
        console.log(`Summarized ${currentIndex + 1}/${responses.length}`);
      } catch (err) {
        const fallback = buildDeterministicSummary(r);
        if (fallback) {
          await prisma.studentResponse.update({
            where: { id: r.id },
            data: { summary: fallback },
          });
          console.log(`Fallback summary ${currentIndex + 1}/${responses.length}`);
        } else {
          console.error(`Failed summary ${currentIndex + 1}:`, err?.message || err);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(worker));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
