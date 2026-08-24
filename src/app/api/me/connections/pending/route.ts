import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { listPending, resolvePending } from "@/server/services/connections";

export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  action: z.enum(["add", "decline"]),
  provider: z.string().min(1).max(32).optional(),
});

/** What the Atlas pill asks about. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return listPending({ userId });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, resolveSchema);
    return resolvePending({ userId, action: input.action, provider: input.provider });
  });
}
