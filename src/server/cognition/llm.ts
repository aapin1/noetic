import type { InsightStyle } from "@prisma/client";
import type { InsightDraft } from "@/server/cognition/insights";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 12000;

/**
 * Classifies precise semantic topics for a piece of content.
 * Topics are derived ONLY from the provided content — never from user history.
 */
export async function extractSemanticTopics(args: {
  title?: string;
  combinedText?: string;
}): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const content = [args.title, args.combinedText?.slice(0, 2000)]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (content.length < 6) return [];

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
              "Classify the intellectual content into 3–7 precise topic labels.",
              "Derive topics ONLY from the provided text — never infer from context outside it.",
              "Prefer specific sub-disciplines and named concepts over broad categories:",
              "  'cartesian rationalism' > 'philosophy'; 'epistemology' > 'knowledge'; 'consciousness studies' > 'mind'.",
              "Include: philosophical movements, scientific sub-fields, named concepts, intellectual traditions, key figures where central.",
              "Exclude: generic words (video, article, blog, technology, content, information), vague categories (ideas, thoughts, things).",
              "All lowercase. No duplicates. Max 7 items.",
              "Return: {\"topics\": [\"...\", ...]}"
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

    if (!response.ok) return [];

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return [];

    const parsed = JSON.parse(raw) as { topics?: unknown };
    if (!Array.isArray(parsed.topics)) return [];

    return parsed.topics
      .filter((t): t is string => typeof t === "string" && t.trim().length >= 2)
      .map((t) => t.trim().toLowerCase())
      .slice(0, 7);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
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
  topicNames?: string[];
  neighborContext?: { title: string; edgeType: string }[];
  drafts: InsightDraft[];
};

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
    "You are an embedded knowledge analyst in a personal memory graph (mneme).",
    "Rewrite each insight draft into something a generalist intellectual with deep reading would find genuinely useful — not obvious, not generic, not flattering.",
    "",
    "HEADLINE rules:",
    "- One sentence. Must be a specific intellectual CLAIM, not a description.",
    "- Bad: 'This touches on philosophy.' Good: 'The cogito shifts the epistemic question from God to self-grounding — a move that haunts modern AI alignment.'",
    "- Identify the non-obvious tension, inversion, or implication in the content.",
    "- If neighbors exist, the headline can name the specific bridge between the items.",
    "",
    "BODY rules:",
    "- 2–3 tight sentences. Each sentence must add something the previous didn't.",
    "- Name the tradition, person, counterargument, or implication — not 'interesting ideas' or 'important topic'.",
    "- If contradicting neighbors exist, specify WHAT exactly is in tension (the mechanism, not the category).",
    "- If reinforcing, say what specific belief gets strengthened and what that costs (echo chamber risk or genuine convergence?).",
    "",
    "OPEN_QUESTION rules:",
    "- One question the user almost certainly hasn't asked themselves.",
    "- Must be answerable with more research, but not trivially. Should feel generative.",
    "- Avoid: 'What do you think about X?' Good: 'Does Descartes' move to res cogitans ultimately depend on the same certainty-in-doubt that he claims to dissolve?'",
    "",
    "Constraints: do not start with 'This capture', 'This article', 'Interesting', or the title verbatim.",
    "Do not state the obvious. If evidence is thin, say so directly rather than overstating.",
    `${styleDirective(args.style)}`,
    "",
    "Return strictly valid JSON (no markdown):",
    '{"insights": [{"index": N, "headline": "...", "body": "...", "open_question": "..."}]}',
  ].join("\n");

  const userMessage = {
    title: args.itemTitle,
    content_text: args.contentText?.slice(0, 1200) ?? "",
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

export async function generateThreadSynthesis(args: {
  topicName: string;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<{ position: string; openQuestion: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 5) return null;

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
