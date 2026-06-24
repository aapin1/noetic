import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { z } from "zod";
import { getFeed } from "@/server/services/social";

const feedSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(40).optional(),
});

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, feedSchema);
    return getFeed({ userId, cursor: input.cursor, limit: input.limit });
  });
}
