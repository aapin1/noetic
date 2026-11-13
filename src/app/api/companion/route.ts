import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getOrCreateCompanionThread, resetCompanionThread } from "@/server/services/companion";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getOrCreateCompanionThread({ userId });
  });
}

/** "New chat" — clears the conversation, returns the fresh thread. */
export async function DELETE(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return resetCompanionThread({ userId });
  });
}
