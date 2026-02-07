import { PrismaClient } from "@prisma/client";
import path from "path";

const rawUrl = process.env.DATABASE_URL;
const resolvedUrl = rawUrl?.startsWith("file:./")
  ? `file:${path.join(process.cwd(), rawUrl.replace("file:./", ""))}`
  : rawUrl;

const prisma = new PrismaClient(
  resolvedUrl
    ? {
        datasources: {
          db: { url: resolvedUrl },
        },
      }
    : undefined
);

export default prisma;
