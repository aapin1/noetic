import { InsightStyle } from "@prisma/client";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { onboardingProfileSchema } from "@/server/contracts";
import { createOnboardingProfile } from "@/server/services/accounts";
import { getOwnerProfile } from "@/server/services/profile";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, onboardingProfileSchema);
    const topics = input.topics ?? [];
    await createOnboardingProfile({
      userId,
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      publicNotes: input.publicNotes,
      avatarUrl: input.avatarUrl,
      topics,
      insightStyle: input.insightStyle as InsightStyle | undefined,
    });
    const composed = await getOwnerProfile(userId);
    return {
      profile: {
        id: composed.user.id,
        handle: composed.user.profile.handle,
        displayName: composed.user.profile.displayName,
        bio: composed.user.profile.bio,
        publicNotes: composed.user.profile.publicNotes,
        avatarUrl: composed.user.profile.avatarUrl,
        identitySummary: composed.user.profile.identitySummary,
        isOnboarded: composed.user.profile.isOnboarded,
      },
    };
  }, 201);
}
