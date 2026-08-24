import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { inspectImport } from "@/server/services/import";
import { enforceRateLimit } from "@/server/services/usage";
import { importSchema } from "@/server/contracts";

export const dynamic = "force-dynamic";

/** What's in the file — formats, rows with words, bare rows — so the screen can ask its one question. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "import-inspect", 30, 60 * 60_000);
    const input = await parseJson(request, importSchema);
    return inspectImport(input);
  });
}
