import { InsightType, type InsightStyle } from "@prisma/client";
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

/**
 * What a named work IS, from the model's own knowledge.
 *
 * A diary entry names a film or a book and nothing else — Letterboxd and
 * Goodreads have no page worth reading, and the keyless resolvers
 * (Wikipedia, Open Library, Steam) miss on one-word titles, translated
 * titles, and anything newer than their search ranking handles. Without a
 * description the pipeline sees a bare title and treats a full review as an
 * unreadable source. The model usually knows the work outright, so ask it.
 *
 * Returns null whenever the model does not recognize the work with
 * confidence: a confabulated blurb would be embedded, classified, and shown
 * as fact, which is far worse than having none. That makes the model's
 * training cutoff the limit of what this can do — the mini model declines a
 * 2025 release outright — so it runs on OPENAI_INSIGHT_MODEL, where a newer
 * model recognizes more of what people are actually logging.
 */
export async function identifyWork(args: {
  kind: string;
  title: string;
  year?: number;
  author?: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

  const systemPrompt = [
    "You identify a published work from its title for a personal knowledge library. The person logged it in a diary app, so all that is known about it is what you are given.",
    "",
    "If you recognize this exact work, describe it in 2-3 plain sentences: what it is (form, year, who made it) and what it is actually about — its subject, setting, and themes. Enough that someone who has never encountered it could read the person's review of it and follow.",
    "Never guess. Return known: false if the title is ambiguous, if you are not sure this is the work meant, or if it may postdate what you know. A wrong description is worse than none.",
    "State only what the work is. No opinion, no reception or ratings, no ending or twist, no invented cast, credits, or awards.",
    "",
    "Return strictly valid JSON (no markdown): {\"known\": true|false, \"description\": \"...\"}",
  ].join("\n");

  const userMessage = {
    kind: args.kind,
    title: args.title,
    year: args.year ?? "",
    author: args.author ?? "",
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
        model: INSIGHT_MODEL(),
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

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { known?: unknown; description?: unknown };
    if (parsed.known !== true) return null;
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    return description.length > 0 ? description : null;
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
  /** Set when the capture is the person's own words ABOUT a work (a film
   * review from Letterboxd, book notes from Goodreads). The polish should try
   * to read their words in relation to that work — and say nothing about a
   * work it does not know. */
  mediaContext?: { kind: string; title: string; siteName?: string };
  /** The user's last few READINGs, newest first: the move each made and how
   * its note opened. The polish is told to make a different move AND open
   * differently, so a run of saves gets a run of different readings rather
   * than "the catch" seven times over in the same sentence shape. */
  recentReadings?: { move?: string; opened_with: string }[];
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
 * The model for the two calls that carry a point of view — the READING's
 * catch and the MIRROR. Both run in the background (latency is free) and the
 * mirror runs once per account, so a stronger model here costs almost nothing
 * per user. Recorded fixtures show the mini model writing "many people
 * believe…" catches — an opinion poll, not a catch — even when told not to;
 * this is the knob to turn if that shows up in production.
 */
const INSIGHT_MODEL = () =>
  process.env.OPENAI_INSIGHT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** A move name as stored: lowercase, no trailing punctuation, short. */
function normalizeMove(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase().replace(/[.:]+$/, "").slice(0, 32) : "";
}

/**
 * Picks the reading's note from the model's candidates. The model drafts
 * three notes under three different moves and names a pick; that pick stands
 * unless its move is one the user was just given, in which case the first
 * candidate whose move is fresh wins instead. Asking for three real
 * alternatives is what makes the choice real — asked for one note, the mini
 * model reached for the same move on five of six captures regardless of what
 * it was told about repetition. Exported for its tests.
 */
export function chooseReadingNote(
  rawOptions: unknown,
  rawPick: unknown,
  recent: { move?: string }[],
): { move: string; note: string } | null {
  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((option) => {
      const row = option as { move?: unknown; note?: unknown } | null;
      return {
        move: normalizeMove(row?.move),
        note: typeof row?.note === "string" ? row.note.trim() : "",
      };
    })
    .filter((option) => option.note.length > 0);
  if (options.length === 0) return null;

  const recentMoves = new Set(recent.map((r) => r.move).filter((m): m is string => !!m));
  const pick = typeof rawPick === "number" && Number.isInteger(rawPick) && options[rawPick] ? options[rawPick] : options[0];
  if (!pick.move || !recentMoves.has(pick.move)) return pick;
  return options.find((option) => option.move && !recentMoves.has(option.move)) ?? pick;
}

export type PolishResult = {
  /** The drafts, rewritten in place — same order and length as the input. */
  insights: InsightDraft[];
  /**
   * The READING: the claim this content makes and the catch in it, written
   * from the content alone. Null when the material was too thin to support one
   * (title-only captures never get one) or the model declined.
   */
  reading: InsightDraft | null;
};

/**
 * Rewrites insight drafts with deep, specific intellectual analysis, and adds
 * the one insight that needs no corpus at all: the READING.
 *
 * Every draft is a graph statistic (neighbour counts, topic counts, a
 * trajectory delta), so a polished draft is a nicer-sounding graph statistic —
 * and on a first capture the only draft is NOVELTY, which says "nothing here
 * yet". The content the user just chose to save is the one asset that is
 * fully present at N=1, and it was never itself the reward. The READING is
 * written in the same call (no extra LLM round-trip, no extra cost): the
 * claim the content actually makes, and the strongest thing wrong with it or
 * quietly assumed by it. That second half is the point of view — a summary is
 * a commodity; a catch is an opinion.
 *
 * Goals for the drafts:
 *  - Headlines are claims, not descriptions.
 *  - Bodies explain WHY something is significant — specific implications, named traditions, non-obvious angles.
 *  - open_question surfaces one generative question the user likely hasn't articulated.
 *  - Neighbor connections name the specific intellectual bridge, not just the category.
 */
export async function polishInsights(args: PolishContext): Promise<PolishResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || args.drafts.length === 0) return { insights: args.drafts, reading: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Thin = a title and nothing else. The grounding directive already forbids
  // inventing the content's argument; a READING is nothing but the content's
  // argument, so it is not even asked for.
  const wantReading = args.contentGrounding !== "thin";

  const systemPrompt = [
    "You are a knowledge analyst in a personal memory graph.",
    "Rewrite each insight draft to be genuinely useful and CONCISE. Say something smart — do not perform being smart. Plain, direct language beats erudition. If a phrase only exists to sound clever, cut it.",
    "",
    wantReading
      ? [
          "READING — the first thing the user sees, and the only insight that needs nothing but the content. Its job is to hand the reader something they did NOT get from the content itself. It has a line, a note, and a kicker:",
          "- line: one sentence that proves you understood this better than a summary would. Vary what kind of sentence it is: the claim it actually makes, stated as a claim; what it is really about underneath its stated subject; the question it is answering without saying so; the thing it takes for granted. Never 'the video discusses…' or 'the author explores…'. If the content is the user's own note, read what THEY are asserting.",
          "- note: one or two sentences that add something from OUTSIDE the content — a fact, a name, a date, a number, a case, a mechanism, a history, a boundary. If the note could have been written by someone who had only read the content, it fails. Choose the move by asking what would be most news to someone who just finished this — never by the content's genre. Some moves:",
          "    · the catch — the specific case it fails on, or the assumption it needs and doesn't give",
          "    · where it comes from — who said this first, in what tradition or era",
          "    · the older version — the same idea in an earlier form, and what got lost or added on the way",
          "    · the test — what you would have to see for it to be right, or wrong",
          "    · the counterexample — one concrete thing the claim cannot explain",
          "    · the mechanism — why it works when it works, in causal terms the content skips",
          "    · the boundary — where it stops applying, and what is on the other side of that line",
          "    · the number — the quantity that reframes it: how big the effect really is, how rare the case",
          "    · the word doing the work — the one term the whole argument leans on, and what it hides",
          "    · the missing step — what has to happen between the advice and the result that the content leaves out",
          "    · the opposite school — the serious tradition that says the reverse, and its best reason",
          "    · the sharper version — the stronger claim buried in it that the author did not quite make",
          "    · the cost — what you give up if you act on it",
          "    · the better example — the case that would have made the point properly",
          "    · what it's selling — the wish it trades on",
          "    or a move of your own. No move belongs to a genre: five self-help videos deserve five different moves, and 'what it's selling' is the last move to reach for on one, not the first.",
          "- options: write THREE candidate notes, each making a different move from the list above (or your own), each with its move named in one to three lowercase words. Three genuinely different notes with different facts in them — not one note relabelled three ways. The move name is shown as the note's label, so it must describe what the note actually does.",
          "- pick: the index of the option that would be most news to someone who just finished this content and that does not repeat a move in recent_readings.",
          "- recent_readings lists this user's last few readings, newest first: the move each made and how its note opened. The pick must not repeat a move on that list, and none of your options may open the way any of them opened. A reader who gets the same move or the same sentence shape twice stops reading.",
          "- Write like a sharp editor's margin note, not a form. Never open a note with 'It assumes', 'Many people', 'This claim', 'This overlooks', 'While', 'Research shows'. Banned: 'oversimplifies', 'doesn't address', 'individual differences', 'complexities', 'nuances', any opinion poll ('many believe', 'some would say'), and any unnamed authority ('research shows', 'studies suggest', 'scientists say', 'experts') — name the study, the person, or the number, or make a different move.",
          "- The line must be grounded in content_text or user_account_of_content. The note may bring in what you know of the world, but must never invent what the content said and must never restate a limitation the content already admits. If the material is too thin to know what it claims (a title, hashtags, a caption, a fragment), set reading to null. A null is better than a guess.",
          "",
        ].join("\n")
      : "",
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
    "NOVELTY drafts: one short line, phrased freshly in this capture's own terms, saying that nothing saved yet sits near it — not a formula. Never promise what saving more will do (no 'save more', 'as you add more', 'patterns will emerge'), never call one capture an 'interest'. It is a footnote, not the point.",
    "",
    "Do not start with 'This capture', 'This article', or the title verbatim. Do not overstate thin evidence.",
    args.mediaContext
      ? [
          `ABOUT A WORK: the capture is the user's own words (a review, notes, a reaction) about the ${args.mediaContext.kind} "${args.mediaContext.title}"${args.mediaContext.siteName ? `, from their ${args.mediaContext.siteName} account` : ""}.`,
          `- FIRST try to read their words in relation to that ${args.mediaContext.kind} — its themes, subject, or craft — if you know the work or content_text describes it.`,
          "- If you do not know the work, do NOT guess or invent anything about it (no plot, no reception, no genre claims). Treat their words on their own terms instead.",
        ].join("\n")
      : "",
    groundingDirective(args.contentGrounding),
    args.userContext
      ? "user_account_of_content is the user's own description of what the content was about — treat it as the authoritative account of the content."
      : "",
    `${styleDirective(args.style)}`,
    "",
    "Return strictly valid JSON (no markdown):",
    wantReading
      ? '{"reading": {"line": "...", "options": [{"move": "...", "note": "..."}, {"move": "...", "note": "..."}, {"move": "...", "note": "..."}], "pick": 0} | null, "insights": [{"index": N, "headline": "...", "body": "...", "open_question": "..."}]}'
      : '{"insights": [{"index": N, "headline": "...", "body": "...", "open_question": "..."}]}',
  ].filter(Boolean).join("\n");

  const userMessage = {
    title: args.itemTitle,
    // Title and excerpt lead the combined text (sourceTokens), then the body.
    // 1200 chars was enough to rewrite graph drafts; finding the claim of a
    // transcript needs to see past its opening. This call runs in the
    // background, so the extra input costs money (a fraction of a cent on the
    // mini model), not latency.
    content_text: args.contentText?.slice(0, 3000) ?? "",
    user_account_of_content: args.userContext?.slice(0, 1200) ?? "",
    topics: args.topicNames ?? [],
    about_work: args.mediaContext ?? undefined,
    recent_readings: wantReading ? (args.recentReadings ?? []) : undefined,
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
        model: INSIGHT_MODEL(),
        temperature: 0.4,
        // Room for the reading's line and three candidate notes on top of
        // the rewritten drafts. Only one note is kept; the other two are the
        // price of a real choice, ~150 output tokens on the mini model.
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userMessage) },
        ],
      }),
    });

    if (!response.ok) return { insights: args.drafts, reading: null };

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { insights: args.drafts, reading: null };

    const parsed = JSON.parse(content) as {
      insights?: { index: number; headline: string; body: string; open_question?: string }[];
      reading?: { line?: unknown; options?: unknown; pick?: unknown } | null;
    };

    const insights = parsed.insights
      ? args.drafts.map((draft, index) => {
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
      })
      : args.drafts;

    // A reading needs both halves: a line without a note is a summary, and a
    // summary is exactly the commodity this is not. The note is chosen from
    // the model's candidates by chooseReadingNote, which holds the no-repeat
    // rule against the user's recent moves. The move's name travels in
    // evidence so the screen can label the note and the next capture's polish
    // can be told not to make it again.
    const line = typeof parsed.reading?.line === "string" ? parsed.reading.line.trim() : "";
    const chosen = wantReading
      ? chooseReadingNote(parsed.reading?.options, parsed.reading?.pick, args.recentReadings ?? [])
      : null;
    const reading: InsightDraft | null =
      line.length > 0 && chosen
        ? {
          type: InsightType.READING,
          headline: line,
          body: chosen.note,
          evidence: { grounding: args.contentGrounding ?? "rich", ...(chosen.move ? { kicker: chosen.move } : {}) },
          strength: 1,
        }
        : null;

    return { insights, reading };
  } catch {
    return { insights: args.drafts, reading: null };
  } finally {
    clearTimeout(timer);
  }
}

/** One of the first captures, as the mirror sees it. */
export type MirrorSubject = {
  title: string;
  /** The AI summary, the user's own words, or null when only a title is known. */
  gist: string | null;
  topics: string[];
};

/**
 * The read at three: one true, specific, slightly uncomfortable sentence about
 * the PERSON, written from their first three captures. Not what the items are
 * about — what the person is collecting. Three saves on mental training, the
 * law of attraction and SAT prep are not "an interest in self-improvement";
 * they are someone collecting techniques for controlling their own mind, and
 * the app can say so at N=3 where every other reflective surface (You,
 * terrain, wrapped) waits for 10, 15, 50 or a year.
 *
 * One call per user, ever (the caller guards on an existing MIRROR row).
 * Returns null when the model can't say one true thing — a null is the
 * honest outcome for three hashtag captions, and nothing is shown.
 */
export async function generateMirror(args: {
  style: InsightStyle;
  captures: MirrorSubject[];
}): Promise<{ headline: string; body: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || args.captures.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    `You have seen exactly ${args.captures.length} things a person chose to save — the first of everything they will ever save. Write the read on the person.`,
    "",
    "READ:",
    "- One sentence, second person. True, specific, and a little uncomfortable: what this person is actually collecting, not what the items are about.",
    "- It must be falsifiable — a sentence this person could push back on — and said in the terms these particular items give you, not generic ones.",
    "- There is no template. Choose the move this set earns: name the thing they keep reaching for (a kind of control, permission, certainty, excuse); name what is conspicuously missing from saves like these; name the question all of them are trying to answer; name what the saving itself looks like (arming, bracing, escaping, rehearsing); or a move of your own. A contrast ('not X but Y') is one move among many — never open with 'You're not', and never use the 'you're not collecting X, you're collecting Y' construction at all; it has become a cliché. A flat declarative, a question, a noticed habit are equally good shapes.",
    "- Horoscopes are banned: anything that would be true of anyone who saves anything. Banned words: 'insights', 'challenge', 'conventional', 'explore', 'complexities', 'perspectives', 'frameworks', 'curious', 'diverse', 'eclectic', 'wide-ranging', 'interested in', 'passionate', 'journey'.",
    "- If the items genuinely share nothing, say what the range itself says about how this person reads — still specific to these items, never 'you have varied interests'.",
    "- Do not name the items in the read; that is what BECAUSE is for.",
    "",
    "BECAUSE:",
    "- One sentence of evidence, in your words, that names the items (short titles are fine) and shows the thread running through them. Do not quote the items back.",
    "",
    "If the material is only titles and hashtags with no substance to read, return {\"read\": null}. A null is better than a guess.",
    styleDirective(args.style),
    "",
    "Return strictly valid JSON (no markdown):",
    '{"read": "...", "because": "..."} or {"read": null}',
  ].join("\n");

  const userMessage = {
    captures: args.captures.map((c) => ({
      title: c.title.slice(0, 160),
      gist: c.gist?.slice(0, 500) ?? "",
      topics: c.topics,
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
        model: INSIGHT_MODEL(),
        temperature: 0.5,
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
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as { read?: unknown; because?: unknown };
    const read = typeof parsed.read === "string" ? parsed.read.trim() : "";
    const because = typeof parsed.because === "string" ? parsed.because.trim() : "";
    if (read.length === 0 || because.length === 0) return null;
    return { headline: read, body: because };
  } catch {
    return null;
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

/** Shared bar for every Mind insight: no observation a stranger could make
 * without having read the user's actual captures. */
const SPECIFICITY_RULES = [
  "SPECIFICITY — the bar every sentence must clear:",
  "- If a generic chatbot could write the sentence WITHOUT having read these exact captures, it is filler. Cut it or sharpen it until it could only be about this user.",
  "- Ground claims in the captures: reference them by (shortened) title, and use their actual arguments, not the topic label.",
  "- Never merely name two camps ('one is materialist, the other panpsychist') — say what the disagreement TURNS ON: the load-bearing assumption that, if settled, would settle the rest.",
  "- Banned words: 'interesting', 'fascinating', 'highlights', 'underscores', 'reflects', 'interplay', 'delve', 'explore further', 'consider reflecting'.",
].join("\n");

export type ContradictionInsight = {
  tension: string;
  /** The question at stake, ≤ 8 words — rendered inside the fracture UI. */
  crux: string | null;
  /** One concrete way to settle it — something the user can do this week. */
  test: string | null;
};

function parseContradictionInsight(raw: string): ContradictionInsight | null {
  const parsed = JSON.parse(raw) as { tension?: unknown; crux?: unknown; test?: unknown };
  if (typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;
  return {
    tension: parsed.tension.trim(),
    crux: typeof parsed.crux === "string" && parsed.crux.trim().length > 0 ? parsed.crux.trim() : null,
    test: typeof parsed.test === "string" && parsed.test.trim().length > 0 ? parsed.test.trim() : null,
  };
}

const CONTRADICTION_OUTPUT_RULES = [
  "Return three fields:",
  "- crux: the question actually at stake between them, ≤ 8 words, phrased as a question. Not the topic ('free will') — the hinge ('Does causal inevitability erase blame?').",
  "- tension: 1-2 sentences. Name the exact claim each side makes (grounded in its actual text), then the load-bearing assumption the disagreement turns on. Do not start with 'These captures' or 'These items'.",
  "- test: ONE concrete way the user could find out which side they actually hold — a question worth answering in a few written lines, a specific comparison worth running, or a specific named thing worth reading that adjudicates. Phrase it as an invitation ('worth asking yourself…', 'you could…'), never as a command, and never 'reflect on this'.",
  "",
  SPECIFICITY_RULES,
  "",
  "Return strictly valid JSON (no markdown): {\"crux\": \"...\", \"tension\": \"...\", \"test\": \"...\"}",
].join("\n");

export async function generateContradictionTension(args: {
  labelA: string;
  textA: string;
  labelB: string;
  textB: string;
}): Promise<ContradictionInsight | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "Two things a user saved hold opposing positions on the same question. You have read both; the user may not have noticed the collision.",
    "",
    CONTRADICTION_OUTPUT_RULES,
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
        max_tokens: 280,
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

    return parseContradictionInsight(raw);
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
}): Promise<({ aIndex: number; bIndex: number } & ContradictionInsight) | null> {
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
    "If nothing genuinely pulls against anything else, return {\"tension\": null} — a forced tension is worse than none.",
    "",
    "Pick the two items (by their index numbers) that are most in tension, then, addressing the user as 'you':",
    CONTRADICTION_OUTPUT_RULES,
    "",
    'Include the indices in the JSON: {"a": <index>, "b": <index>, "crux": "...", "tension": "...", "test": "..."} or {"tension": null}',
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
        max_tokens: 320,
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

    const insight = parseContradictionInsight(raw);
    if (!insight) return null;
    const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown };
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

    return { aIndex, bIndex, ...insight };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ThreadDriftNote = {
  /** Index into the (chronological) capture list this note sits after. */
  atIndex: number;
  text: string;
};

export async function generateThreadSynthesis(args: {
  topicName: string;
  /** Chronological (oldest first) when capturedAt is provided — drift notes
   * describe movement along this order. */
  captures: { label: string; keyIdea: string | null; text: string; capturedAt?: string }[];
}): Promise<{
  position: string;
  openQuestion: string;
  heading?: string;
  driftNotes?: ThreadDriftNote[];
} | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 3) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has been circling the same topic from multiple angles. Captures are listed in the order they were saved (oldest first). You can see the whole arc; they only saw one item at a time.",
    "Your job is diagnosis, not summary: where has their thinking actually landed, how did it move, and what should they do next.",
    "",
    "POSITION rules:",
    "- One sentence. A specific, falsifiable intellectual claim about what they seem to believe — cite the capture(s) that push them there by shortened title.",
    "- Bad: 'You have explored consciousness from many angles.' Good: 'Between \"Integrated Information\" and \"The Hard Problem is a Category Error\" you've moved from measuring consciousness to doubting it can be measured — you now treat irreducibility as the default.'",
    "- Address the user directly as 'you'.",
    "",
    "HEADING rules:",
    "- The position compressed to 3-6 words, lowercase, no ending period — the direction of travel, e.g. 'toward embodied cognition', 'against measurement optimism'.",
    "",
    "OPEN_QUESTION rules:",
    "- One question the user hasn't yet asked themselves but that follows naturally from this position.",
    "- Should feel generative — answerable with more thought or research.",
    "",
    "DRIFT_NOTES rules:",
    "- 1-3 short observations of how the thinking MOVED across the sequence — a shift in angle, framing, or conviction between earlier and later captures.",
    "- Each note: {\"after\": <index of the capture it follows>, \"note\": \"...\"} — one sentence, max ~20 words, addressed as 'you'.",
    "- Only note real shifts. If the sequence shows no movement, return an empty list.",
    "",
    SPECIFICITY_RULES,
    "",
    "Return strictly valid JSON (no markdown): {\"position\": \"...\", \"heading\": \"...\", \"open_question\": \"...\", \"drift_notes\": [{\"after\": 0, \"note\": \"...\"}]}",
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
        max_tokens: 460,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c, i) => ({
                index: i,
                title: c.label,
                key_idea: c.keyIdea ?? "",
                excerpt: c.text.slice(0, 400),
                ...(c.capturedAt ? { captured_at: c.capturedAt } : {}),
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

    const parsed = JSON.parse(raw) as {
      position?: unknown;
      open_question?: unknown;
      heading?: unknown;
      drift_notes?: unknown;
    };
    if (
      typeof parsed.position !== "string" || parsed.position.trim().length === 0 ||
      typeof parsed.open_question !== "string" || parsed.open_question.trim().length === 0
    ) return null;

    const driftNotes: ThreadDriftNote[] = [];
    if (Array.isArray(parsed.drift_notes)) {
      for (const row of parsed.drift_notes) {
        if (typeof row !== "object" || row === null) continue;
        const after = (row as { after?: unknown }).after;
        const note = (row as { note?: unknown }).note;
        if (typeof after !== "number" || typeof note !== "string" || note.trim().length === 0) continue;
        const atIndex = Math.trunc(after);
        if (atIndex < 0 || atIndex >= args.captures.length) continue;
        driftNotes.push({ atIndex, text: note.trim() });
        if (driftNotes.length >= 3) break;
      }
    }

    const heading =
      typeof parsed.heading === "string" && parsed.heading.trim().length > 0
        ? parsed.heading.trim()
        : undefined;

    return {
      position: parsed.position.trim(),
      openQuestion: parsed.open_question.trim(),
      ...(heading ? { heading } : {}),
      ...(driftNotes.length > 0 ? { driftNotes } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ConvergenceInsight = {
  signal: string;
  /** The destination idea compressed to ≤ 8 words — the keystone's label. */
  arrival: string | null;
  /** Where this convergence points next — one concrete move. */
  act: string | null;
};

export async function generateConvergenceSignal(args: {
  topicName: string;
  captures: { label: string; source: string | null; keyIdea: string | null }[];
}): Promise<ConvergenceInsight | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 2) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has arrived at the same intellectual territory from completely different sources. They probably haven't noticed — you can see all the paths at once.",
    "",
    "Return three fields, addressing the user directly as 'you':",
    "- arrival: the destination idea compressed to ≤ 8 words, lowercase — the single thought all paths lead to. Not the topic name; the idea itself.",
    "- signal: 1-2 sentences naming what each source's DISTINCT path was (grounded in the actual captures, by shortened title or source) and the precise idea where they meet. The value is the triangulation: independent routes to one point is evidence the idea matters to you.",
    "- act: one concrete direction this convergence points to — e.g. a capture pair worth re-reading side by side, the converged idea worth putting in your own words, or a specific named next thing worth reading that extends it. Phrase it as an invitation ('worth…', 'you could…'), never as a command.",
    "",
    SPECIFICITY_RULES,
    "",
    "Return strictly valid JSON (no markdown): {\"arrival\": \"...\", \"signal\": \"...\", \"act\": \"...\"}",
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
        max_tokens: 300,
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

    const parsed = JSON.parse(raw) as { signal?: unknown; arrival?: unknown; act?: unknown };
    if (typeof parsed.signal !== "string" || parsed.signal.trim().length === 0) return null;

    return {
      signal: parsed.signal.trim(),
      arrival:
        typeof parsed.arrival === "string" && parsed.arrival.trim().length > 0
          ? parsed.arrival.trim()
          : null,
      act: typeof parsed.act === "string" && parsed.act.trim().length > 0 ? parsed.act.trim() : null,
    };
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

/**
 * The "arc" for the terrain self-portrait: a short reflective synthesis of the
 * pre-computed longitudinal metrics. Grounded ONLY in the numbers and topic
 * names it is handed — no raw capture content — so it stays cheap and is cached
 * (regenerated ~once per 25 captures). Returns null on any failure; the screen
 * falls back to its deterministic chapters.
 */
export async function generateTerrainNarrative(args: {
  spanDays: number;
  captureCount: number;
  driftDegrees: number | null;
  driftBand: string | null;
  towardField: string | null;
  awayField: string | null;
  spreadVerdict: string | null;
  earlyFields: string[];
  recentFields: string[];
  enduring: string[];
  emerged: string[];
  faded: string[];
  bridges: { a: string; b: string }[];
  topVoices?: string[];
  spreadDeltaPct?: number | null;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "You are writing the closing 'arc' of a person's intellectual self-portrait, drawn from how their captured thinking has moved between an early era and a recent one.",
    "You are given ONLY pre-computed measurements and topic names — treat them as ground truth and do not invent specifics beyond them.",
    "",
    "Write 2–3 sentences, addressing the user directly as 'you', lowercase-leaning, quietly observational — the tone of a perceptive reader of one's own notebooks, not a hype summary.",
    "Say what actually MOVED and what HELD: name the enduring core (what stayed) alongside the drift (what changed), because the constancy is half the portrait. If a toward/away field or a widening/deepening verdict is given, let it shape the sentence rather than being listed.",
    "Do not restate the raw numbers (no '17 degrees'); render them as meaning.",
    "",
    SPECIFICITY_RULES,
    "",
    'Return strictly valid JSON (no markdown): {"arc": "..."}',
  ].join("\n");

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(args) },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { arc?: unknown };
    return typeof parsed.arc === "string" && parsed.arc.trim().length > 0 ? parsed.arc.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the text off frames or slides of a social post — TikTok photo
 * slideshows, Instagram carousels, and speechless videos whose whole
 * argument is burned-in text. Verbatim, frame-labelled plain text; a frame
 * with no meaningful text gets a one-sentence description instead. Cheap
 * vision model by default (slides are large text); null on any failure.
 */
export async function readSocialFrames(args: {
  images: { base64: string; mimeType: string }[];
  caption?: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || args.images.length === 0) return null;

  const count = args.images.length;
  const instruction = [
    `${count === 1 ? "This is a frame" : `These are ${count} frames/slides, in order,`} from a short social-media post${
      args.caption ? ` whose caption is: "${args.caption.slice(0, 300).replace(/\s+/g, " ")}"` : ""
    }.`,
    `Transcribe ALL visible text verbatim, in reading order, one block per frame labelled "Frame 1:", "Frame 2:", … Keep the original wording; do not summarise, translate, or fix typos.`,
    "Only when a frame has no meaningful text, describe in one short sentence what it shows.",
    "Never invent text that is not visible. Return plain text, no markdown.",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_SOCIAL_VISION_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              ...args.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "auto" },
              })),
            ],
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
