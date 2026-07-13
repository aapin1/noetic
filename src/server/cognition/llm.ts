import type { InsightStyle } from "@prisma/client";
import type { InsightDraft } from "@/server/cognition/insights";
import { GENERAL_TOPICS, normalizeGeneral } from "@/server/cognition/generalTopics";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const TIMEOUT_MS = 12000;
// Calls the user actively waits on during capture get a tighter budget: a
// typical run is 1-3s, so a hung request should degrade (raw metadata /
// keyword fallback) rather than pin the capture sheet for 12s.
const CAPTURE_TIMEOUT_MS = 8000;
const EMBED_TIMEOUT_MS = 6000;
const EMBED_MODEL = "text-embedding-3-small";

/**
 * Embeds text into a semantic vector. This is the backbone of the cognitive
 * map: positions and connections are derived from these vectors, not keywords.
 * Returns null on any failure (caller falls back to keyword similarity).
 */
export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const input = text.trim().slice(0, 8000);
  if (input.length < 3) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBED_MODEL ?? EMBED_MODEL,
        input,
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: { embedding?: number[] }[];
    };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) return null;
    return vector;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribes a short voice note (the capture fail-safe's spoken "what was
 * this about?") via Whisper. Returns null on any failure so the caller can
 * tell the user to type instead.
 */
export async function transcribeAudio(args: {
  base64: string;
  mimeType?: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const buffer = Buffer.from(args.base64, "base64");
    if (buffer.length < 200) return null;

    const mimeType = args.mimeType ?? "audio/m4a";
    const ext = mimeType.split("/").pop()?.split(";")[0] ?? "m4a";
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), `note.${ext}`);
    form.append("model", "whisper-1");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { text?: unknown };
    if (typeof payload.text !== "string") return null;
    const text = payload.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CleanedMetadata = {
  title: string;
  author: string | null;
  excerpt: string | null;
};

/**
 * Normalizes scraped article metadata into a clean title, author byline, and a
 * meaningful excerpt. The model decides what is substantive vs. boilerplate —
 * nothing is hard-coded to strip specific phrases. Returns null on failure so
 * the caller keeps the raw scraped values.
 */
export async function cleanContentMetadata(args: {
  rawTitle: string;
  rawDescription?: string;
  rawAuthor?: string;
  siteName?: string;
  bodyText?: string;
}): Promise<CleanedMetadata | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

  const systemPrompt = [
    "You clean scraped article metadata for a personal knowledge library. Work only from the data given.",
    "",
    "Return three fields:",
    "- title: the work's actual title. Remove author names, site names, and section suffixes that aren't part of the title (e.g. 'My Essay — by Jane Doe | Substack' → 'My Essay'). Keep the real title verbatim otherwise; never invent one.",
    "- author: the human author's name if determinable, else null. Never put the author in the title.",
    "- excerpt: 1–2 sentences stating what the piece is actually about, drawn from its substantive content. Exclude boilerplate of ANY kind — subscription prompts, navigation, cookie notices, share/like calls, newsletter pitches, 'read more', author bios. If no substantive content is available, return null. Do not fabricate.",
    "",
    "Return strictly valid JSON (no markdown): {\"title\": \"...\", \"author\": \"...\" | null, \"excerpt\": \"...\" | null}",
  ].join("\n");

  const userMessage = {
    raw_title: args.rawTitle,
    raw_description: args.rawDescription ?? "",
    raw_author: args.rawAuthor ?? "",
    site_name: args.siteName ?? "",
    body_text: args.bodyText?.slice(0, 4000) ?? "",
  };

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
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userMessage) },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { title?: unknown; author?: unknown; excerpt?: unknown };
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : args.rawTitle;
    const author =
      typeof parsed.author === "string" && parsed.author.trim().length > 0
        ? parsed.author.trim()
        : null;
    const excerpt =
      typeof parsed.excerpt === "string" && parsed.excerpt.trim().length > 0
        ? parsed.excerpt.trim()
        : null;

    return { title, author, excerpt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ImageDescription = {
  title: string;
  description: string;
  /** Short, non-verbatim gist of the image for display (never the full transcription). */
  summary: string | null;
};

/**
 * Extracts the substantive meaning of a captured image so it can be embedded,
 * classified, and connected like any other capture — the vision equivalent of
 * scraping an article. The model transcribes meaningful text (screenshots, book
 * pages, slides) or describes the subject when there is little text. Returns
 * null on any failure so the caller falls back to caption/reaction text.
 */
export async function describeImage(args: {
  base64: string;
  mimeType: string;
}): Promise<ImageDescription | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!args.base64 || args.base64.length < 16) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const instruction = [
    "Extract the substantive meaning of this image for a personal knowledge library. Work only from what is visible; never fabricate.",
    "- If the image contains meaningful text (a screenshot, book page, slide, quote, article), transcribe that text verbatim into the description.",
    "- If it is a photo, diagram, or artwork with little text, describe the subject and what makes it noteworthy.",
    "Also return a summary: ONE short sentence naming what the image is about, in your own words — never a verbatim transcription. This is shown to the user as the gist.",
    "Return strictly valid JSON (no markdown): {\"title\": \"...\", \"description\": \"...\", \"summary\": \"...\"} where title is a short handle, description is 1-3 sentences (or the transcribed text) of substance, and summary is one plain sentence.",
  ].join("\n");

  const dataUrl = `data:${args.mimeType};base64,${args.base64}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { title?: unknown; description?: unknown; summary?: unknown };
    const description =
      typeof parsed.description === "string" && parsed.description.trim().length > 0
        ? parsed.description.trim()
        : null;
    if (!description) return null;

    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : description.slice(0, 80);
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : null;

    return { title, description, summary };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One (general field, specific sub-topic) framing of a piece of content. */
export type TopicClassification = {
  /** Coarse field, always one of GENERAL_TOPICS — the map's clustering anchor. */
  general: string;
  /** AI-generated fine-grained label naming what it is specifically about. */
  specific: string;
};

export type SemanticTopics = {
  /**
   * 1–3 (general, specific) pairs. Normally exactly one; up to three only when
   * the content is genuinely interdisciplinary. Empty when content is too thin
   * or the LLM is unavailable.
   */
  classifications: TopicClassification[];
};

/**
 * Classifies a piece of content into 1–3 (general field, specific topic) pairs.
 * Derived ONLY from the provided content — never from user history.
 *
 * Every entry pairs a coarse `general` field (the map's clustering anchor, always
 * drawn from GENERAL_TOPICS) with a precise AI-generated `specific` sub-topic.
 * A single field is the norm; extra fields are added ONLY for genuinely
 * interdisciplinary content (strict). Retries once on transient failure.
 */
export async function extractSemanticTopics(args: {
  title?: string;
  combinedText?: string;
  /** The user's existing specific sub-topics, keyed by the general field each
   * one actually lives under. The model reuses a label (verbatim) when the
   * content names the same subject, so near-duplicate sub-topics ("stoic
   * philosophy" vs "stoicism") don't fragment the map. Attributing each label
   * to its field is what stops the reverse failure: offered a flat list, the
   * model happily files an LLM article under "ai in biology" because the words
   * look adjacent. A label is only ever a candidate within its own field. */
  existingTopicsByGeneral?: Record<string, string[]>;
}): Promise<SemanticTopics> {
  const empty: SemanticTopics = { classifications: [] };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("extractSemanticTopics: OPENAI_API_KEY is not set; falling back to keyword classification");
    return empty;
  }

  const content = [args.title, args.combinedText?.slice(0, 2000)]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (content.length < 6) return empty;

  // Flatten to "field: label, label" lines, capped at 40 labels overall so the
  // prompt stays a fixed size as the map grows.
  let budget = 40;
  const existingLines: string[] = [];
  for (const [general, specifics] of Object.entries(args.existingTopicsByGeneral ?? {})) {
    if (budget <= 0) break;
    const labels = specifics
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, budget);
    if (labels.length === 0) continue;
    budget -= labels.length;
    existingLines.push(`   ${general}: ${labels.join(", ")}`);
  }

  const body = JSON.stringify({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 180,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You file a piece of writing into a personal knowledge map. Work ONLY from the text provided — never infer from outside context.",
          "",
          "Return a list of classifications. Each classification has:",
          "- general — the broad field it belongs to. MUST be exactly one of this fixed list:",
          `   ${GENERAL_TOPICS.join(", ")}.`,
          "   Pick the closest field even if none is perfect. The general field decides which region of the map the content lands in, so judge it by the ACTUAL subject matter — never by an incidental word. A physics article that mentions a 'thin film' is science, not film. A history essay that mentions a court case is history, not law.",
          "- specific — one precise sub-topic label naming what the content is specifically about within that field. Prefer a named sub-discipline, theory, movement, tradition, or key concept: 'quantum mechanics' under science, 'epistemology' under philosophy, 'metaphysics' under philosophy. Never just restate the general field.",
          ...(existingLines.length > 0
            ? [
                "",
                "The user's map already contains these specific sub-topics, listed under the general field each one lives in:",
                ...existingLines,
                "",
                "Reuse an existing label only when ALL of these hold:",
                "   1. It is listed under the SAME general field you chose. A label filed under a different field is never a candidate, no matter how related its words sound.",
                "   2. It names the SAME subject as this content, allowing for different wording — 'stoicism' covers 'stoic philosophy', 'epistemology' covers 'theory of knowledge'.",
                "   3. It is neither broader nor narrower than what the content is actually about.",
                "   Otherwise coin a new specific label. Adjacency is NOT a fit: an article about large language models is 'large language models', not the existing 'ai in biology' — those share a word, not a subject. A paper on protein folding is not 'machine learning' just because it uses a model.",
                "   Fragmenting the map with a new label is a much smaller error than filing content under a label that does not describe it. When genuinely torn, coin the new label.",
                "   When you do reuse, copy the label EXACTLY as written above.",
              ]
            : []),
          "",
          "How many classifications:",
          "- Almost always return exactly ONE. Most content lives in a single field.",
          "- Return two or (rarely) three ONLY when the content genuinely and substantively draws on multiple distinct fields at once — e.g. an essay on what quantum physics implies for free will is [science/quantum physics, philosophy/free will]. Be strict: a passing mention of another field does NOT count. Maximum three.",
          "",
          "Rules:",
          "- All lowercase. No duplicate general fields. Exclude generic words (video, article, blog, content) and vague terms (ideas, thoughts, things).",
          "",
          // The literal word "JSON" MUST appear somewhere in the messages —
          // OpenAI 400s any response_format:json_object request whose prompt
          // omits it ("'messages' must contain the word 'json'…"), which would
          // silently drop every capture to the keyword/general fallback.
          "Respond strictly as JSON: {\"classifications\": [{\"general\": \"...\", \"specific\": \"...\"}, ...]}",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          title: args.title ?? "",
          text: args.combinedText?.slice(0, 1800) ?? "",
        }),
      },
    ],
  });

  const attempt = async (): Promise<SemanticTopics | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        console.error("extractSemanticTopics: OpenAI request failed", response.status, await response.text().catch(() => ""));
        return null;
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = payload.choices?.[0]?.message?.content;
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { classifications?: unknown };

      const rows = Array.isArray(parsed.classifications) ? parsed.classifications : [];
      const seenGeneral = new Set<string>();
      const classifications: TopicClassification[] = [];

      for (const row of rows) {
        if (typeof row !== "object" || row === null) continue;
        const rawGeneral = (row as { general?: unknown }).general;
        const rawSpecific = (row as { specific?: unknown }).specific;

        // Reject free-form generals: the field must be one of the fixed set so
        // clustering stays stable and the general/specific split is derivable.
        const general = typeof rawGeneral === "string" ? normalizeGeneral(rawGeneral) : null;
        if (!general || seenGeneral.has(general)) continue;

        const specific =
          typeof rawSpecific === "string" && rawSpecific.trim().length >= 2
            ? rawSpecific.trim().toLowerCase()
            : "";
        // Never let a specific echo the general field verbatim.
        const cleanSpecific = specific === general ? "" : specific;

        seenGeneral.add(general);
        classifications.push({ general, specific: cleanSpecific });
        if (classifications.length >= 3) break;
      }

      return { classifications };
    } catch (err) {
      console.error("extractSemanticTopics: request/parse error", err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // One retry: transient timeouts/429s should not drop us to the keyword path.
  const first = await attempt();
  if (first && first.classifications.length > 0) return first;
  const second = await attempt();
  if (second && second.classifications.length > 0) return second;
  return first ?? second ?? empty;
}

function styleDirective(style: InsightStyle): string {
  if (style === "REFLECTIVE") {
    return "Tone: contemplative, second-person ('you'). Phrases like 'Notice...' or 'Worth sitting with...'. Warm but never sentimental.";
  }
  if (style === "ANALYTICAL") {
    return "Tone: precise, third-person. Reference counts, directional signals, named concepts. No hedging unless uncertainty is real.";
  }
  return "Tone: sharp, declarative, editorial. No hedging, no cheerfulness, no exclamation points.";
}

export type PolishContext = {
  style: InsightStyle;
  itemTitle: string;
  contentText?: string;
  /** How much actual substance grounds this capture (rich transcript/body vs.
   * short excerpt vs. title-only). Drives the anti-confabulation directive. */
  contentGrounding?: "rich" | "partial" | "thin";
  /** The user's own account of what the content was about — authoritative. */
  userContext?: string;
  topicNames?: string[];
  neighborContext?: { title: string; edgeType: string }[];
  drafts: InsightDraft[];
};

function groundingDirective(grounding: "rich" | "partial" | "thin" | undefined): string {
  if (grounding === "thin") {
    return [
      "GROUNDING — CRITICAL:",
      "- You know almost NOTHING about this content beyond its title. Do NOT reconstruct, assume, or invent what it argues, claims, or covers.",
      "- Never present an inferred argument as the content's argument. Ground every claim in the connection/pattern evidence (neighbors, topics, recurrence) or the user's own words.",
      "- If a draft asserts something about the content itself that the data cannot support, rewrite it to be about the pattern instead.",
    ].join("\n");
  }
  if (grounding === "partial") {
    return [
      "GROUNDING:",
      "- You have only a short excerpt of this content, not the full text. Do not extrapolate specific claims the excerpt does not make.",
    ].join("\n");
  }
  return "";
}

/**
 * Rewrites insight drafts with deep, specific intellectual analysis.
 *
 * Goals:
 *  - Headlines are claims, not descriptions.
 *  - Bodies explain WHY something is significant — specific implications, named traditions, non-obvious angles.
 *  - open_question surfaces one generative question the user likely hasn't articulated.
 *  - Neighbor connections name the specific intellectual bridge, not just the category.
 */
export async function polishInsights(args: PolishContext): Promise<InsightDraft[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || args.drafts.length === 0) return args.drafts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "You are a knowledge analyst in a personal memory graph.",
    "Rewrite each insight draft to be genuinely useful and CONCISE. Say something smart — do not perform being smart. Plain, direct language beats erudition. If a phrase only exists to sound clever, cut it.",
    "",
    "HEADLINE:",
    "- One plain sentence: a specific point about this capture or its link to the user's other saved items.",
    "- No jargon, name-dropping, or rhetorical flourish for effect. Say the actual point.",
    "- When related_items exist, name the concrete connection to them (reference the item by title) rather than the category.",
    "",
    "BODY:",
    "- One sentence. Add a second only if it makes a genuinely distinct point — never to pad.",
    "- Say it directly. No filler ('it may be worth noting', 'this is significant because'), no throat-clearing, no restating the headline.",
    "- Never use 'interesting', 'important', 'fascinating', 'delve', or em-dash-strung clauses that add length without meaning.",
    "- Contradiction neighbors: name WHAT is in tension. Reinforcement: say what belief gets strengthened, and whether it's real convergence or just an echo.",
    "",
    "OPEN_QUESTION (optional):",
    "- Include ONLY if a genuinely generative, specific question exists. One short line. Omit it otherwise — never force one.",
    "",
    "Do not start with 'This capture', 'This article', or the title verbatim. Do not overstate thin evidence.",
    groundingDirective(args.contentGrounding),
    args.userContext
      ? "user_account_of_content is the user's own description of what the content was about — treat it as the authoritative account of the content."
      : "",
    `${styleDirective(args.style)}`,
    "",
    "Return strictly valid JSON (no markdown):",
    '{"insights": [{"index": N, "headline": "...", "body": "...", "open_question": "..."}]}',
  ].filter(Boolean).join("\n");

  const userMessage = {
    title: args.itemTitle,
    content_text: args.contentText?.slice(0, 1200) ?? "",
    user_account_of_content: args.userContext?.slice(0, 1200) ?? "",
    topics: args.topicNames ?? [],
    related_items: (args.neighborContext ?? []).map((n) => ({
      title: n.title,
      relationship: n.edgeType,
    })),
    drafts: args.drafts.map((d, i) => ({
      index: i,
      type: d.type,
      current_headline: d.headline,
      current_body: d.body,
    })),
  };

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
        temperature: 0.4,
        max_tokens: 360,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userMessage) },
        ],
      }),
    });

    if (!response.ok) return args.drafts;

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return args.drafts;

    const parsed = JSON.parse(content) as {
      insights?: { index: number; headline: string; body: string; open_question?: string }[];
    };
    if (!parsed.insights) return args.drafts;

    return args.drafts.map((draft, index) => {
      const replacement = parsed.insights?.find((e) => e.index === index);
      if (!replacement?.headline) return draft;
      return {
        ...draft,
        headline: replacement.headline.trim(),
        body: replacement.body?.trim() || draft.body,
        evidence: {
          ...draft.evidence,
          ...(replacement.open_question ? { open_question: replacement.open_question.trim() } : {}),
        },
      };
    });
  } catch {
    return args.drafts;
  } finally {
    clearTimeout(timer);
  }
}

export type Recommendation = {
  title: string;
  author: string;
  why: string;
};

export async function generateRecommendations(args: {
  itemTitle: string;
  contentText?: string;
  topicNames: string[];
  threadContext?: { topicName: string; captureCount: number };
  neighborTitles: string[];
}): Promise<Recommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const threadNote = args.threadContext && args.threadContext.captureCount >= 2
    ? `The user has captured ${args.threadContext.captureCount} things on "${args.threadContext.topicName}" — this is the next entry in that thread.`
    : "";

  const systemPrompt = [
    "Recommend exactly 3 specific pieces of content for a user to explore next, given what they just captured.",
    "",
    "Requirements:",
    "- Each recommendation must be a real, specific work (book, essay, paper, talk, or article) with an actual named author.",
    "- 'why' must name the specific intellectual connection — not 'this is relevant' but the precise bridge (shared argument, opposing view, historical antecedent, empirical grounding, etc.).",
    "- Vary the format: do not recommend 3 books or 3 articles. Mix at least 2 different formats.",
    "- Prioritize depth over breadth — go deeper into the thread, not sideways into adjacent topics.",
    "- Do not recommend things the user has already captured (given the neighbor titles).",
    "",
    threadNote,
    "",
    "Return strictly valid JSON (no markdown):",
    '{"recommendations": [{"title": "...", "author": "...", "why": "..."}]}',
  ].filter(Boolean).join("\n");

  const userMessage = {
    captured_title: args.itemTitle,
    captured_text: args.contentText?.slice(0, 800) ?? "",
    topics: args.topicNames,
    already_in_map: args.neighborTitles,
  };

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
        temperature: 0.5,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userMessage) },
        ],
      }),
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as {
      recommendations?: { title?: string; author?: string; why?: string }[];
    };

    if (!Array.isArray(parsed.recommendations)) return [];

    return parsed.recommendations
      .filter((r): r is Recommendation =>
        typeof r.title === "string" && r.title.length > 0 &&
        typeof r.author === "string" && r.author.length > 0 &&
        typeof r.why === "string" && r.why.length > 0,
      )
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function generateContradictionTension(args: {
  labelA: string;
  textA: string;
  labelB: string;
  textB: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "Two saved captures appear to hold opposing positions on the same question.",
    "Name the specific intellectual tension between them in 1-2 sentences.",
    "Requirements:",
    "- Name the exact claim in conflict, not the general topic area.",
    "- Bad: 'These items disagree about free will.' Good: 'Item A grounds moral responsibility in the causal structure of neural events, while Item B holds that uncompelled choice is a necessary condition for culpability — the disagreement turns on whether causal inevitability eliminates genuine agency.'",
    "- Do not start with 'These captures' or 'These items'.",
    "Return strictly valid JSON (no markdown): {\"tension\": \"...\"}",
  ].join("\n");

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
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              item_a: { title: args.labelA, text: args.textA.slice(0, 800) },
              item_b: { title: args.labelB, text: args.textB.slice(0, 800) },
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { tension?: unknown };
    if (typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;

    return parsed.tension.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Softer, broader counterpart to generateContradictionTension. Rather than
 * requiring a hard polarity-opposed edge, this scans the captures within a
 * single topic for the sharpest *unresolved tension* — friction, ambivalence,
 * or competing intuitions that don't fully add up. Returns the two captures in
 * tension (by index into the provided array) or null when nothing genuinely
 * pulls against anything else.
 */
export async function generateTopicTension(args: {
  topicName: string;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<{ aIndex: number; bIndex: number; tension: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 2) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "You are given a numbered list of things a user has saved under one topic.",
    "Find the single sharpest UNRESOLVED TENSION between two of them.",
    "This need NOT be a direct logical contradiction ('X is opposed to Y').",
    "It counts as tension whenever two ideas pull against each other, sit in",
    "uneasy balance, reveal ambivalence, or simply don't add up together.",
    "Requirements:",
    "- Pick the two items (by their index numbers) that are most in tension.",
    "- Name the specific friction in 1-2 sentences, addressing the user as 'you'.",
    "- Do not start with 'These captures' or 'These items'.",
    "- If nothing genuinely pulls against anything else, return null.",
    'Return strictly valid JSON (no markdown): {"a": <index>, "b": <index>, "tension": "..."} or {"tension": null}',
  ].join("\n");

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
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              items: args.captures.map((c, i) => ({
                index: i,
                title: c.label,
                key_idea: c.keyIdea ?? "",
                excerpt: c.text.slice(0, 400),
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown; tension?: unknown };
    if (typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;
    if (typeof parsed.a !== "number" || typeof parsed.b !== "number") return null;

    const aIndex = Math.trunc(parsed.a);
    const bIndex = Math.trunc(parsed.b);
    if (
      aIndex === bIndex ||
      aIndex < 0 || aIndex >= args.captures.length ||
      bIndex < 0 || bIndex >= args.captures.length
    ) {
      return null;
    }

    return { aIndex, bIndex, tension: parsed.tension.trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateThreadSynthesis(args: {
  topicName: string;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<{ position: string; openQuestion: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 3) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has been circling the same topic from multiple angles.",
    "Based on what they've saved, state where their thinking appears to have landed — not a summary of what they read, but a claim about what they seem to believe.",
    "",
    "POSITION rules:",
    "- One sentence. A specific intellectual claim, not a category description.",
    "- Bad: 'The user has explored consciousness from many angles.' Good: 'The pattern suggests you hold that subjective experience is not reducible to physical processes, though you remain uncertain about what that irreducibility implies.'",
    "- Address the user directly as 'you'.",
    "",
    "OPEN_QUESTION rules:",
    "- One question the user hasn't yet asked themselves but that follows naturally from this position.",
    "- Should feel generative — answerable with more thought or research.",
    "",
    "Return strictly valid JSON (no markdown): {\"position\": \"...\", \"open_question\": \"...\"}",
  ].join("\n");

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
        temperature: 0.4,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c) => ({
                title: c.label,
                key_idea: c.keyIdea ?? "",
                excerpt: c.text.slice(0, 400),
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { position?: unknown; open_question?: unknown };
    if (
      typeof parsed.position !== "string" || parsed.position.trim().length === 0 ||
      typeof parsed.open_question !== "string" || parsed.open_question.trim().length === 0
    ) return null;

    return {
      position: parsed.position.trim(),
      openQuestion: parsed.open_question.trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateConvergenceSignal(args: {
  topicName: string;
  captures: { label: string; source: string | null; keyIdea: string | null }[];
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 2) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has arrived at the same intellectual territory from multiple completely different sources.",
    "Name the convergent insight in 1-2 sentences — the core idea they keep returning to, and why it's notable that it arrived from such different starting points.",
    "Be specific about the divergent paths AND the convergent destination.",
    "Address the user directly as 'you'.",
    "Return strictly valid JSON (no markdown): {\"signal\": \"...\"}",
  ].join("\n");

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
        temperature: 0.4,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c) => ({
                title: c.label,
                source: c.source ?? "unknown",
                key_idea: c.keyIdea ?? "",
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { signal?: unknown };
    if (typeof parsed.signal !== "string" || parsed.signal.trim().length === 0) return null;

    return parsed.signal.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluatePositionTension(args: {
  topicName: string;
  positionStatement: string;
  captureTitle: string;
  captureText: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    `A user has stated a position on "${args.topicName}". They just captured something new on the same topic.`,
    "Determine if the new capture genuinely challenges, complicates, or undermines the stated position.",
    "If yes: name the specific tension in 1-2 sentences — what exactly in the capture conflicts with what exactly in the position.",
    "If the capture reinforces or is neutral to the position, return has_tension: false.",
    "",
    "Rules:",
    "- Only flag genuine intellectual tension, not superficial disagreement.",
    "- Name the exact claim in the capture that conflicts with the exact aspect of the position.",
    "- Do not start the tension with 'This capture' or 'The new capture'.",
    "- Bad: 'They disagree about free will.' Good: 'The capture's causal-closure argument removes the space the position's agent-causation claim requires.'",
    "",
    "Return strictly valid JSON (no markdown): {\"tension\": \"...\" | null, \"has_tension\": true | false}",
  ].join("\n");

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
        temperature: 0.2,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              position: args.positionStatement,
              capture_title: args.captureTitle,
              capture_text: args.captureText.slice(0, 800),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { tension?: unknown; has_tension?: boolean };
    if (!parsed.has_tension || typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;

    return parsed.tension.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateSocraticOpening(args: {
  topicName: string;
  positionStatement: string | null;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const positionNote = args.positionStatement
    ? `The user has stated a position: "${args.positionStatement}". Open by probing the assumption this position most depends on.`
    : "The user has not yet stated a position. Open by identifying the unresolved tension in what they've captured.";

  const positionContext = args.positionStatement
    ? `The user has stated a position: "${args.positionStatement}". Analyze how their captures support or complicate this position.`
    : "The user has not yet stated a position. Identify what their captures reveal about where their thinking is heading.";

  const systemPrompt = [
    `You are Mneme, an intelligent knowledge companion with full access to the user's captured ideas on "${args.topicName}".`,
    "Open with a direct, useful observation — surface what's genuinely interesting or non-obvious from their data.",
    "",
    positionContext,
    "",
    "Rules:",
    "- Lead with insight, not a question. Be analytical and direct.",
    "- Reference the actual pattern, tension, or implication you see across their captures.",
    "- Go beyond what individual captures say — name what the collection reveals together.",
    "- Do not summarize what they already know. Surface what's non-obvious.",
    "- Do not start with affirmations, 'You've been exploring', or throat-clearing.",
    "- 2–3 sentences. You may end with a brief invitation to explore a specific angle, but this is optional.",
    "",
    "Return strictly valid JSON (no markdown): {\"challenge\": \"...\"}",
  ].join("\n");

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
        temperature: 0.5,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c) => ({
                title: c.label,
                key_idea: c.keyIdea ?? "",
                excerpt: c.text.slice(0, 300),
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { challenge?: unknown };
    if (typeof parsed.challenge !== "string" || parsed.challenge.trim().length === 0) return null;

    return parsed.challenge.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateSocraticResponse(args: {
  topicName: string;
  positionStatement: string | null;
  captures: { label: string; keyIdea: string | null }[];
  conversationHistory: { role: "USER" | "COMPANION"; content: string }[];
  userReply: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const positionNote = args.positionStatement
    ? `The user's stated position: "${args.positionStatement}".`
    : "The user has not yet stated a position.";

  const systemPrompt = [
    `You are Mneme, an intelligent knowledge companion with full access to the user's captured ideas on "${args.topicName}".`,
    positionNote,
    "You have read all their captures and can draw connections between them.",
    "",
    "Your role: help the user analyze, connect, and go deeper — be a direct, helpful analyst, not a questioner.",
    "- If the user asks a question: answer it directly and concretely using their data. Reference specific captures when useful. 2-3 sentences.",
    "- If the user shares a thought or insight: build on it. Add what you see from their captures that they might have missed. Surface structural patterns or implications that span multiple captures.",
    "- Produce 'beyond-knowledge': name what the pattern of their captures suggests collectively, not just what individual captures say.",
    "- Go beyond the explicit nodes — if their data points somewhere interesting, say so directly.",
    "",
    "Do not repeat or paraphrase what the user said.",
    "Do not start with 'That's...' or any affirmation. No filler. Be specific.",
    "4 sentences maximum. A follow-up question is optional and only when it would genuinely unlock new territory.",
    "",
    "Return strictly valid JSON (no markdown): {\"challenge\": \"...\"}",
  ].join("\n");

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...args.conversationHistory.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
    { role: "user" as const, content: args.userReply },
  ];

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
        temperature: 0.5,
        max_tokens: 160,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { challenge?: unknown };
    if (typeof parsed.challenge !== "string" || parsed.challenge.trim().length === 0) return null;

    return parsed.challenge.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateCompanionResponse(args: {
  contextBlock: string;
  focusBlock?: string;
  conversationHistory: { role: "USER" | "COMPANION"; content: string }[];
  userMessage: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "You are Mneme's knowledge companion — a personal AI with access to the user's knowledge map.",
    "You know every topic they've explored, every capture they've saved (numbered newest-first), their stated intellectual positions, and the connections between captures.",
    "",
    args.contextBlock,
    "",
    ...(args.focusBlock
      ? [
          args.focusBlock,
          "",
          "The user has already selected the focus items above as exactly what they're asking about — the message names them directly. Answer using them immediately; never ask which items or connection they mean, and never respond with a clarifying question in place of an answer. Use the rest of the knowledge map only for supporting context.",
          "",
        ]
      : []),
    "Answer what the user asks. Be direct and specific.",
    "- For factual questions: answer concisely in 2-3 sentences. Do not add a question after every answer.",
    "- For connection questions: name the specific intellectual bridge (concept, argument, mechanism) in 2-3 sentences.",
    "- Only add a follow-up question when it opens genuinely useful territory — not as a default reflex.",
    "",
    "Rules:",
    "- Reference captures by number when relevant: 'Capture #4...'",
    "- Do not start with affirmations, 'Great question', or 'As your knowledge companion'.",
    "- 4 sentences maximum. A closing question is optional.",
    "- Name the concept, argument, or mechanism. Never say 'interesting' or 'important'.",
    "- No filler. Cut anything that doesn't add information.",
  ].join("\n");

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...args.conversationHistory.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
    { role: "user" as const, content: args.userMessage },
  ];

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
        temperature: 0.5,
        max_tokens: 280,
        messages,
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    return raw.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
