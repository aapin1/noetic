import { handleRoute } from "@/lib/api";
import { getRequestUserId } from "@/lib/auth";
import { publicProfileSchema } from "@/server/contracts";
import { getPublicProfile } from "@/server/services/profile";

export async function GET(
  request: Request,
  context: { params: { handle: string } },
) {
  return handleRoute(async () => {
    const viewerId = await getRequestUserId(request);
    const params = publicProfileSchema.parse(context.params);
    return getPublicProfile(params.handle, viewerId);
  });
}
