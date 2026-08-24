import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { requestSync, unlinkConnection } from "@/server/services/connections";
import { enforceRateLimit } from "@/server/services/usage";

export const dynamic = "force-dynamic";

const syncSchema = z.object({
  /** A feed body the phone fetched itself, for providers that turn servers away. */
  feedText: z.string().max(5_000_000).optional(),
});

/** "check now" — optionally carrying a feed the phone fetched. */
export async function POST(request: Request, { params }: { params: { provider: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "connection-sync", 6, 60 * 60_000);
    const body = request.headers.get("content-length") && request.headers.get("content-length") !== "0" ? await parseJson(request, syncSchema) : {};
    return { connection: await requestSync({ userId, provider: params.provider, feedText: body.feedText }) };
  });
}

export async function DELETE(request: Request, { params }: { params: { provider: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    await unlinkConnection({ userId, provider: params.provider });
    return { ok: true };
  });
}
