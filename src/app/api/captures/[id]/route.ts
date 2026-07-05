import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureUpdateSchema } from "@/server/contracts";
import { deleteCapture, getCapture, updateCaptureContext } from "@/server/services/cognition";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getCapture({ userId, capturedItemId: params.id });
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, captureUpdateSchema);
    return updateCaptureContext({
      userId,
      capturedItemId: params.id,
      userContext: input.userContext,
    });
  });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    await deleteCapture({ userId, capturedItemId: params.id });
    return { deleted: true };
  });
}
