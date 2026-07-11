import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { deleteAccount } from "@/server/services/accounts";

/**
 * Permanent account deletion — required by App Store Guideline 5.1.1(v) for
 * any app with account creation. Cascades every piece of the user's data.
 */
export async function DELETE(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return deleteAccount({ userId });
  });
}
