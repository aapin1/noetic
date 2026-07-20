import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getTerrain } from "@/server/services/terrain";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
    const tzOffsetMinutes = raw === null ? 0 : Number(raw);
    return getTerrain(userId, { tzOffsetMinutes });
  });
}
