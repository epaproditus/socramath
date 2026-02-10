import { auth } from "@/auth";
import { mkdir, stat, writeFile } from "fs/promises";
import path from "path";

const FORMULA_FILENAME = "formula-sheet.pdf";

const getFormulaPath = () =>
  path.join(process.cwd(), "public", "uploads", FORMULA_FILENAME);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await stat(getFormulaPath());
    return Response.json({ exists: true, url: `/uploads/${FORMULA_FILENAME}` });
  } catch {
    return Response.json({ exists: false, url: "" });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.email || !adminEmail || session.user.email !== adminEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return new Response("File must be a PDF", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const targetPath = getFormulaPath();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);

  return Response.json({ ok: true, url: `/uploads/${FORMULA_FILENAME}` });
}
