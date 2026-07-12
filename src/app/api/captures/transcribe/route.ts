import { AppError, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureTranscribeSchema } from "@/server/contracts";
import { transcribeAudio } from "@/server/cognition/llm";
import { consumeUsageOrThrow } from "@/server/services/usage";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    await consumeUsageOrThrow(userId, "voice_transcription");
    const input = await parseJson(request, captureTranscribeSchema);
    const text = await transcribeAudio({ base64: input.audioBase64, mimeType: input.mimeType });

    if (!text) {
      throw new AppError("TRANSCRIPTION_FAILED", "Could not transcribe that recording — try typing instead.", 422);
    }

    return { text };
  });
}
