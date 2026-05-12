import type { InsightStyle } from "@prisma/client";
import type { InsightDraft } from "@/server/cognition/insights";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 6000;

/**
 * Uses the LLM to extract specific, semantically meaningful topic labels from
 * content. Returns precise sub-disciplines and concepts rather than broad
 * categories — e.g. "existentialism" rather than "philosophy".
 */
export async function extractSemanticTopics(args: {
  title?: string;
  combinedText?: string;
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return [];
  }

  const content = [args.title, args.combinedText?.slice(0, 2000)]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (content.length < 20) {
    return [];
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
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a precise semantic topic classifier.",
              "Identify 4-8 specific, meaningful topics for the given content.",
              "Prefer specific over generic: 'existentialism' over 'philosophy', 'machine learning' over 'AI', 'stoicism' over 'ethics'.",
              "Include sub-disciplines, movements, concepts, and key figures where relevant.",
              "Avoid generic words like 'video', 'article', 'blog', 'content', 'technology'.",
              "Return only lowercase strings. No duplicates.",
              "Respond with a JSON object: {\"topics\": [\"topic1\", \"topic2\", ...]}",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              title: args.title ?? "",
              text: args.combinedText?.slice(0, 1800) ?? "",
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { topics?: unknown };
    const topics = parsed.topics;

    if (!Array.isArray(topics)) {
      return [];
    }

    return topics
      .filter((t): t is string => typeof t === "string" && t.trim().length >= 2)
      .map((t) => t.trim().toLowerCase())
      .slice(0, 8);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function styleSystemPrompt(style: InsightStyle): string {
  const base = [
    "You are an intelligent memory assistant embedded in mneme, a personal knowledge graph that tracks what a user reads, saves, and thinks about over time.",
    "Your task: given a set of insight drafts about a piece of content the user just committed to their memory, rewrite each insight with a sharp headline and a substantive body.",
    "The headline must be 1 sentence — specific, intellectually honest, and non-generic.",
    "The body must be 2–3 sentences that: (1) explain what the pattern or connection means in context, (2) name a concrete implication or open question worth sitting with, and optionally (3) connect it to broader intellectual territory.",
    "Constraints: never repeat the source title verbatim; no filler phrases like 'great capture' or 'interesting idea'; do not start with 'This capture' or 'This article'; if evidence is thin, say so honestly rather than overstating.",
    "Return strictly valid JSON with this shape: {\"headlines\": [{\"index\": number, \"headline\": string, \"body\": string}]}. No markdown fences, no extra keys.",
  ].join(" ");

  if (style === "REFLECTIVE") {
    return base + " Tone: contemplative and personal. Speak directly to the user with 'you'. Use phrases like 'Notice this...' or 'Worth sitting with...'. Warm but never sentimental.";
  }

  if (style === "ANALYTICAL") {
    return base + " Tone: precise and data-grounded. Use third person. Reference counts, ratios, and directional signals explicitly. No hedging unless uncertainty is real.";
  }

  return base + " Tone: sharp, direct, editorial. Declarative sentences. No hedging, no cheerfulness, no exclamation points.";
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
      headlines?: { index: number; headline: string; body?: string }[];
    };

    if (!parsed.headlines) {
      return args.drafts;
    }

    return args.drafts.map((draft, index) => {
      const replacement = parsed.headlines?.find((entry) => entry.index === index);
      const headline = replacement?.headline?.trim();
      const body = replacement?.body?.trim();

      if (!headline) {
        return draft;
      }

      return { ...draft, headline, ...(body ? { body } : {}) };
    });
  } catch {
    return args.drafts;
  } finally {
    clearTimeout(timer);
  }
}
