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
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Extract 2–5 precise topic labels from the provided content only.",
              "- Derive topics ONLY from what is written. Never infer from surrounding context.",
              "- Stay within the content's primary discipline. Neuroscience ≠ philosophy. Biology ≠ chemistry. Do not bleed into adjacent fields even if they share concepts (e.g., 'mind').",
              "- Prefer specific sub-disciplines over broad categories: 'cognitive neuroscience' > 'neuroscience' > 'science'; 'epistemology' > 'philosophy of knowledge' > 'philosophy'.",
              "- Include: scientific sub-fields, named theories/concepts, philosophical movements, intellectual traditions, key figures when central.",
              "- Exclude: generic words (video, article, blog, content, information), vague terms (ideas, thoughts, things, topics).",
              "- All lowercase. No duplicates.",
              "Return: {\"topics\": [\"...\", ...]}",
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
    "You are a knowledge analyst in a personal memory graph.",
    "Rewrite each insight draft. Be specific and direct — no flattery, no filler, nothing generic.",
    "",
    "HEADLINE:",
    "- One sentence. A specific intellectual CLAIM, not a description.",
    "- Bad: 'This touches on philosophy.' Good: 'The cogito shifts the epistemic question from God to self-grounding — a move that haunts modern AI alignment.'",
    "- Identify the non-obvious tension, inversion, or implication. If neighbors exist, name the specific bridge.",
    "",
    "BODY:",
    "- 2 tight sentences. Each must add something the previous didn't.",
    "- Name the tradition, person, counterargument, or mechanism. Never say 'interesting' or 'important'.",
    "- No filler: cut 'It may be worth noting', 'One might consider', 'This is significant because'.",
    "- Contradiction neighbors: name WHAT is in tension (mechanism, not category). Reinforcement: say what belief gets strengthened and whether it's convergence or echo.",
    "",
    "OPEN_QUESTION:",
    "- One question the user hasn't asked. Must be specific and generative — answerable with more research.",
    "- Bad: 'What do you think about X?' Good: 'Does Descartes' move to res cogitans depend on the same certainty-in-doubt he claims to dissolve?'",
    "",
    "Do not start with 'This capture', 'This article', or the title verbatim. Do not overstate thin evidence.",
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
        max_tokens: 480,
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

  const systemPrompt = [
    `You are the Socratic companion in Mneme, a personal memory map for a user exploring "${args.topicName}".`,
    "Your role: find the precise point where their thinking is unresolved and put pressure on it.",
    "",
    positionNote,
    "",
    "Rules:",
    "- Do not summarize their captures.",
    "- Name one specific tension, contradiction, or unstated assumption in what they've saved.",
    "- End with exactly one question — precise, specific, answerable with more thought.",
    "- Do not start with 'Great!', affirmations, 'You've been exploring', or any throat-clearing.",
    "- No filler phrases. No flowery language. Say the thing directly.",
    "- 2–3 sentences maximum. The question is the last sentence.",
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
    `You are the Socratic companion in a personal memory map for a user exploring "${args.topicName}".`,
    positionNote,
    "You have read all their captures on this topic.",
    "",
    "First, identify the TYPE of the user's reply:",
    "- QUESTION: the message ends with '?' or explicitly asks you to explain, define, or clarify something.",
    "  → Answer directly and concretely in 2-3 sentences. Give the actual answer. Do not respond with another question.",
    "- CLAIM or ARGUMENT: the user asserts something or defends a position.",
    "  → Find the weakest assumption in what they said. Do not paraphrase it back. Challenge it with exactly one question — more specific than the last, zooming in not out. 2-3 sentences + question.",
    "- REFLECTION or UNCERTAINTY: the user admits they're unsure or thinking out loud.",
    "  → Clarify the specific tension they're wrestling with. 1-2 sentences. Optionally one follow-up question only if it opens productive ground.",
    "",
    "Do not repeat or paraphrase what the user said.",
    "Do not start with 'That's...' or any affirmation.",
    "No filler phrases. No flowery language.",
    "4 sentences maximum.",
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
