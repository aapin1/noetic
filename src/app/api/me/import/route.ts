import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { importSchema } from "@/server/contracts";
import { getImportJob, startImport } from "@/server/services/import";
import { enforceRateLimit } from "@/server/services/usage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Import deliberately does NOT touch the 30/5min capture bucket — it has
    // its own lane and its own ceiling (the 200-row cap plus this).
    enforceRateLimit(userId, "import", 5, 60 * 60_000);
    const input = await parseJson(request, importSchema);
    return { job: await startImport({ userId, ...input }) };
  });
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return { job: getImportJob(userId) };
  });
}
