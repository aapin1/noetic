import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { linkConnection, listConnections } from "@/server/services/connections";
import { enforceRateLimit } from "@/server/services/usage";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  provider: z.string().min(1).max(32),
  /** Whatever the person has: a username, a profile link, a token. */
  input: z.string().min(1).max(512),
});

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return { connections: await listConnections({ userId }) };
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Each link is an outbound request to the provider on the person's behalf.
    enforceRateLimit(userId, "connection-link", 10, 60 * 60_000);
    const input = await parseJson(request, linkSchema);
    return { connection: await linkConnection({ userId, provider: input.provider, input: input.input }) };
  }, 201);
}
