import { AppError, assertBodyWithinLimit, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureScreenshotSchema } from "@/server/contracts";
import { describeImage } from "@/server/cognition/llm";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { USAGE_CAPS, tryConsumeUsage, usageLimitNoticeFor } from "@/server/services/usage";

/** Headroom over the schema's 8,000,000-char base64 cap for the JSON envelope. */
const MAX_BODY_BYTES = 9 * 1024 * 1024;

/** Room left in the 4,000-char userContext after the user's own words. */
const MAX_TEXT_CHARS = 3000;

/**
 * Reads a screenshot of a source the scraper couldn't get past (paywall,
 * Facebook/LinkedIn login wall) and hands the text back for the capture
 * sheet's "what was this about?" box. Nothing is stored: the user sees and
 * can edit the text before it is saved as their context.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "read-screenshot", 20, 5 * 60_000);
    assertBodyWithinLimit(request, MAX_BODY_BYTES);
    const input = await parseJson(request, captureScreenshotSchema);
    const base64 = input.imageBase64.replace(/^data:[^;]+;base64,/, "");

    // Same meter as image captures — it is the same gpt-4o vision call. The
    // stock opening sentence talks about a saved image; keep its reset date
    // and upsell, swap only that sentence.
    if (!(await tryConsumeUsage(userId, "image_describe"))) {
      const notice = await usageLimitNoticeFor(userId, "image_describe");
      const message = notice.message.replace(
        USAGE_CAPS.image_describe.message,
        `You've used this month's ${notice.limit} image reads, so Mneme can't read this screenshot. Tell Mneme what it's about instead.`,
      );
      throw new AppError("USAGE_LIMIT", message, 429, { ...notice, message });
    }

    const described = await describeImage({ base64, mimeType: input.mimeType ?? "image/jpeg" });
    if (!described) {
      throw new AppError("SCREENSHOT_UNREADABLE", "Couldn't read that screenshot. Try typing what it's about instead.", 422);
    }

    const text = described.summary && described.summary !== described.description
      ? `${described.summary}\n\n${described.description}`
      : described.description;
    return { text: text.slice(0, MAX_TEXT_CHARS) };
  });
}
