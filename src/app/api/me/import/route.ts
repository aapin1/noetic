import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { getImportJob, startImport } from "@/server/services/import";

export const dynamic = "force-dynamic";

// 2MB of text covers even decade-old bookmark files; anything larger is
// probably not a link list.
const importSchema = z.object({
  content: z.string().min(1).max(2_000_000),
  filename: z.string().max(255).optional(),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Import deliberately does NOT touch the 30/5min capture bucket — it has
    // its own lane and its own ceiling (the 200-URL cap plus this).
    enforceRateLimit(userId, "import", 5, 60 * 60_000);
    const input = await parseJson(request, importSchema);
    return { job: await startImport({ userId, content: input.content, filename: input.filename }) };
  });
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return { job: getImportJob(userId) };
  });
}
