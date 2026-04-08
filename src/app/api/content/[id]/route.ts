import { handleRoute } from "@/lib/api";
import { getRequestUserId } from "@/lib/auth";
import { contentPageSchema } from "@/server/contracts";
import { getContentPage } from "@/server/services/content-page";

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  return handleRoute(async () => {
    const viewerId = await getRequestUserId(request);
    const params = contentPageSchema.parse(context.params);
    return getContentPage({
      contentItemId: params.id,
      viewerId,
    });
  });
}
