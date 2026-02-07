import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const config = await prisma.appConfig.findFirst();
  return Response.json({
    baseUrl: config?.baseUrl || "",
    model: config?.model || "",
    systemPrompt: config?.systemPrompt || "",
  });
}
