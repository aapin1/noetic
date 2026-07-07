import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { listArchiveFolders } from "@/server/services/archive";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const folders = await listArchiveFolders({ userId });
    return { folders };
  });
}
