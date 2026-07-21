import { AppError, assertBodyWithinLimit, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureTranscribeSchema } from "@/server/contracts";
import { transcribeAudio } from "@/server/cognition/llm";
import { transcription } from "@/server/services/admission";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { consumeUsageOrThrow } from "@/server/services/usage";

/** Headroom over the schema's 12,000,000-char base64 cap for the JSON envelope. */
const MAX_BODY_BYTES = 14 * 1024 * 1024;

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "transcribe", 20, 5 * 60_000);
    assertBodyWithinLimit(request, MAX_BODY_BYTES);
    await consumeUsageOrThrow(userId, "voice_transcription");
    const input = await parseJson(request, captureTranscribeSchema);
    const text = await transcription.run(() =>
      transcribeAudio({ base64: input.audioBase64, mimeType: input.mimeType }),
    );

    if (!text) {
      throw new AppError("TRANSCRIPTION_FAILED", "Could not transcribe that recording — try typing instead.", 422);
    }

    return { text };
  });
}
