import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const resolveSqliteUrl = (rawUrl?: string) => {
  if (!rawUrl) return undefined;
  if (!rawUrl.startsWith("file:./")) return rawUrl;

  const relativePath = rawUrl.replace("file:./", "");
  const baseCandidates = Array.from(
    new Set([process.cwd(), process.env.INIT_CWD, process.env.PWD].filter(Boolean) as string[])
  );

  const fileCandidates = baseCandidates.map((base) => path.resolve(base, relativePath));
  const existing = fileCandidates.find((candidate) => fs.existsSync(candidate));
  const resolvedPath = existing ?? fileCandidates[0];
  return `file:${resolvedPath}`;
};

const resolvedUrl = resolveSqliteUrl(process.env.DATABASE_URL);

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
