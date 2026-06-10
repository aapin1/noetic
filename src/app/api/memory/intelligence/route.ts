import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPersonalIntelligence } from "@/server/services/intelligence";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPersonalIntelligence({ userId });
  });
}
