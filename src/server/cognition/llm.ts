import type { InsightStyle } from "@prisma/client";
import type { InsightDraft } from "@/server/cognition/insights";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 6000;

function styleSystemPrompt(style: InsightStyle): string {
  if (style === "REFLECTIVE") {
    return "You are a reflective companion. Restate insight headlines as quiet, intelligent observations, never cheerful. 1 sentence, max 14 words.";
  }

  if (style === "ANALYTICAL") {
    return "You are a precise analyst. Restate insight headlines as concise factual statements with the embedded numbers. 1 sentence, max 16 words.";
  }

  return "You are a sharp, restrained editor. Restate insight headlines in fewer than 12 words. No greetings. No exclamation points.";
}

export async function polishInsights(args: {
  style: InsightStyle;
  itemTitle: string;
  drafts: InsightDraft[];
}): Promise<InsightDraft[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || args.drafts.length === 0) {
    return args.drafts;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: styleSystemPrompt(args.style) },
          {
            role: "user",
            content: JSON.stringify({
              capture_title: args.itemTitle,
              drafts: args.drafts.map((draft) => ({
                index: args.drafts.indexOf(draft),
                type: draft.type,
                headline: draft.headline,
                body: draft.body,
              })),
              instruction: "Return JSON {\"headlines\": [{\"index\": number, \"headline\": string}]}. Only restyle the headline; keep the meaning.",
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return args.drafts;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      return args.drafts;
    }

    const parsed = JSON.parse(content) as {
      headlines?: { index: number; headline: string }[];
    };

    if (!parsed.headlines) {
      return args.drafts;
    }

    return args.drafts.map((draft, index) => {
      const replacement = parsed.headlines?.find((entry) => entry.index === index);
      const headline = replacement?.headline?.trim();

      if (!headline) {
        return draft;
      }

      return { ...draft, headline };
    });
  } catch {
    return args.drafts;
  } finally {
    clearTimeout(timer);
  }
}
