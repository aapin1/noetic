import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { updateProfileSchema } from "@/server/contracts";
import { updateProfile } from "@/server/services/accounts";
import { getOwnerProfile } from "@/server/services/profile";

export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, updateProfileSchema);
    await updateProfile({
      userId,
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      publicNotes: input.publicNotes,
      avatarUrl: input.avatarUrl,
      topics: input.topics,
    });
    return getOwnerProfile(userId);
  });
}
