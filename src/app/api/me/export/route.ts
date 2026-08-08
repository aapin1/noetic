import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getExport } from "@/server/services/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getExport({ userId });
  });
}
