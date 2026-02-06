import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";
import pdfParse from "pdf-parse";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const prisma = new PrismaClient();

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

  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }

  const filename = file.name || "lesson.pdf";
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return new Response("Please upload a PDF file", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const pageTexts: string[] = [];
  const parsed = await pdfParse(buffer, {
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
        pageCount: parsed.numpages || pageTexts.length || 0,
        isActive: true,
      },
    });
  });

  const safeDir = path.join(process.cwd(), "public", "uploads", "lessons", lesson.id);
  await mkdir(safeDir, { recursive: true });
  const pdfDiskPath = path.join(safeDir, "source.pdf");
  await writeFile(pdfDiskPath, buffer);
  const publicPdfPath = `/uploads/lessons/${lesson.id}/source.pdf`;

  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { pdfPath: publicPdfPath },
  });

  if (pageTexts.length) {
    await prisma.lessonSlide.createMany({
      data: pageTexts.map((text, idx) => ({
        lessonId: lesson.id,
        index: idx + 1,
        text,
      })),
    });
  } else if (parsed.numpages) {
    await prisma.lessonSlide.createMany({
      data: Array.from({ length: parsed.numpages }).map((_, idx) => ({
        lessonId: lesson.id,
        index: idx + 1,
        text: "",
      })),
    });
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
