import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import pdfParse from "pdf-parse";
import { mkdir, writeFile, rm, readdir, rename } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";


function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}


export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const answerKey = form.get("answerKey");

  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }

  const filename = file.name || "lesson.pdf";
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return new Response("Please upload a PDF file", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsePdf = async (input: Buffer) => {
    const pageTexts: string[] = [];
    const parsed = await pdfParse(input, {
      pagerender: (pageData: any) =>
        pageData.getTextContent().then((tc: any) => {
          const text = tc.items
            .map((item: any) => ("str" in item ? item.str : ""))
            .join(" ");
          const normalized = normalizeText(text);
          pageTexts.push(normalized);
          return text;
        }),
    });
    const content = normalizeText(parsed.text || "");
    const pageCount = parsed.numpages || parsed.numrender || pageTexts.length || 0;
    return { pageTexts, content, pageCount };
  };

  const { pageTexts, content, pageCount } = await parsePdf(buffer);

  if (!content) {
    return new Response("No text found in PDF", { status: 400 });
  }

  const title = form.get("title");
  const lessonTitle =
    typeof title === "string" && title.trim()
      ? title.trim()
      : filename.replace(/\.[^.]+$/, "");

  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    return new Response("Admin user not found. Log in once as admin.", { status: 400 });
  }

  const lesson = await prisma.$transaction(async (tx) => {
    await tx.lesson.updateMany({
      where: { userId: adminUser.id, isActive: true },
      data: { isActive: false },
    });
    return tx.lesson.create({
      data: {
        userId: adminUser.id,
        title: lessonTitle,
        content,
        sourceFilename: filename,
        pageCount,
        isActive: true,
      },
    });
  });

  const safeDir = path.join(process.cwd(), "public", "uploads", "lessons", lesson.id);
  await mkdir(safeDir, { recursive: true });
  const pdfDiskPath = path.join(safeDir, "source.pdf");
  await writeFile(pdfDiskPath, buffer);
  const publicPdfPath = `/uploads/lessons/${lesson.id}/source.pdf`;

  const slidesDir = path.join(safeDir, "slides");
  await rm(slidesDir, { recursive: true, force: true });
  await mkdir(slidesDir, { recursive: true });

  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { pdfPath: publicPdfPath },
  });

  if (pageTexts.length) {
    await prisma.$transaction(
      pageTexts.map((text, idx) =>
        prisma.lessonSlide.create({
          data: {
            lessonId: lesson.id,
            index: idx + 1,
            text,
          },
        })
      )
    );
  } else if (pageCount) {
    await prisma.$transaction(
      Array.from({ length: pageCount }).map((_, idx) =>
        prisma.lessonSlide.create({
          data: {
            lessonId: lesson.id,
            index: idx + 1,
            text: "",
          },
        })
      )
    );
  }

  if (answerKey && answerKey instanceof File) {
    const answerName = answerKey.name || "answer-key.pdf";
    if (!answerName.toLowerCase().endsWith(".pdf")) {
      return new Response("Answer key must be a PDF", { status: 400 });
    }
    const answerBuffer = Buffer.from(await answerKey.arrayBuffer());
    const { pageTexts: answerTexts } = await parsePdf(answerBuffer);
    if (answerTexts.length) {
      await prisma.$transaction(
        answerTexts.map((text, idx) =>
          prisma.lessonSlide.updateMany({
            where: { lessonId: lesson.id, index: idx + 1 },
            data: { rubric: JSON.stringify([text]) },
          })
        )
      );
    }
  }

  // Render each page to a PNG for fast slide display (Pear Deck style)
  if (pageCount) {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("pdftoppm", ["-png", "-r", "144", pdfDiskPath, path.join(slidesDir, "slide")]);
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || "pdftoppm failed"));
      });
    });

    const files = await readdir(slidesDir);
    await Promise.all(
      files.map(async (file) => {
        const match = file.match(/^slide-(\d+)\.png$/);
        if (!match) return;
        const pageNum = match[1];
        const from = path.join(slidesDir, file);
        const to = path.join(slidesDir, `${pageNum}.png`);
        await rename(from, to);
      })
    );
  }

  return Response.json({
    id: lesson.id,
    title: lesson.title,
    content: lesson.content,
    pageCount: lesson.pageCount,
    pdfPath: publicPdfPath,
    isActive: lesson.isActive,
    createdAt: lesson.createdAt,
  });
}
