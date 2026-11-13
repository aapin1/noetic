import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import { embedText, generateCompanionResponse } from "@/server/cognition/llm";
import { cosineSim } from "@/server/cognition/layout";

// The prompt carries the whole map at two resolutions. DETAIL: the most
// recent captures plus the ones most relevant to the conversation (by
// embedding similarity), each with a line of substance. INDEX: every other
// capture by title, grouped under its topic — so the companion knows the
// whole map exists, not just the newest slice. Both are bounded so prompt
// size stays sane no matter how large the map grows.
const INDEX_LIMIT = 600;
const EMBED_SCAN_LIMIT = 300;
const DETAIL_CAP = 60;
const RECENT_LIMIT = 20;
const EDGE_LIMIT = 80;
const GIST_CHARS = 220;
const INDEX_TITLE_CHARS = 70;

const DEFAULT_OPENING =
  "Your knowledge map is ready. Ask me anything about your captures, topics, or the connections between them.";

type ContextCapture = {
  id: string;
  rawText: string | null;
  caption: string | null;
  keyIdea: string | null;
  summary: string | null;
  userContext: string | null;
  userTitle: string | null;
  reaction: string | null;
  contentItem: { title: string } | null;
  topics: { weight: number; topic: { name: string } }[];
};

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

// The user's own rename wins, so the companion names captures the way the
// user sees them on the map.
function captureTitle(c: ContextCapture): string {
  return c.userTitle ?? c.contentItem?.title ?? c.rawText?.slice(0, 80) ?? c.caption?.slice(0, 80) ?? "Untitled";
}

/** One short line of substance per capture — link captures have rawText = null,
 * so without the summary/userContext fallback the companion only saw titles. */
function captureGist(c: ContextCapture): string {
  const gist = [c.keyIdea, c.userContext, c.summary, c.rawText, c.caption]
    .find((part) => part && part.trim().length > 0) ?? "";
  return truncate(gist, GIST_CHARS);
}

export async function buildCompanionContext(
  userId: string,
  db: DbClient,
  retrievalText: string,
): Promise<string> {
  const [userTopics, positions, captures, totalCaptures, embeddings] = await Promise.all([
    db.userTopic.findMany({
      where: { userId },
      orderBy: { weight: "desc" },
      include: {
        topic: {
          include: { _count: { select: { capturedTags: { where: { capturedItem: { userId } } } } } },
        },
      },
    }),
    db.userPosition.findMany({
      where: { userId, status: "ACTIVE" },
      include: { topic: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.capturedItem.findMany({
      where: { userId },
      orderBy: { capturedAt: "desc" },
      take: INDEX_LIMIT,
      select: {
        id: true,
        rawText: true,
        caption: true,
        keyIdea: true,
        summary: true,
        userContext: true,
        userTitle: true,
        reaction: true,
        contentItem: { select: { title: true } },
        topics: { select: { weight: true, topic: { select: { name: true } } } },
      },
    }),
    db.capturedItem.count({ where: { userId } }),
    // Embeddings are the heavy column, so only the newest slice is ranked.
    db.capturedItem.findMany({
      where: { userId },
      orderBy: { capturedAt: "desc" },
      take: EMBED_SCAN_LIMIT,
      select: { id: true, embedding: true },
    }),
  ]);

  // Stable newest-first numbering over the whole listed map, so "Capture #4"
  // means the same thing whether #4 is in the detail block or the index.
  const captureIndex = new Map(captures.map((c, i) => [c.id, i + 1]));

  let detailed: ContextCapture[] = captures;
  if (captures.length > DETAIL_CAP) {
    const chosen = new Set(captures.slice(0, RECENT_LIMIT).map((c) => c.id));
    const queryEmbedding = await embedText(retrievalText);

    if (queryEmbedding) {
      const ranked = embeddings
        .filter((e) => !chosen.has(e.id) && e.embedding.length > 0)
        .map((e) => ({ id: e.id, score: cosineSim(queryEmbedding, e.embedding) }))
        .sort((a, b) => b.score - a.score);
      for (const { id } of ranked) {
        if (chosen.size >= DETAIL_CAP) break;
        chosen.add(id);
      }
    } else {
      // Embedding unavailable: degrade to plain recency.
      for (const c of captures.slice(0, DETAIL_CAP)) chosen.add(c.id);
    }

    detailed = captures.filter((c) => chosen.has(c.id));
  }

  const detailedIds = new Set(detailed.map((c) => c.id));
  const edges = detailedIds.size > 0
    ? await db.memoryEdge.findMany({
        where: {
          userId,
          fromItemId: { in: Array.from(detailedIds) },
          toItemId: { in: Array.from(detailedIds) },
        },
        select: { fromItemId: true, toItemId: true, type: true },
        take: EDGE_LIMIT,
      })
    : [];

  const topicsLine = userTopics
    .map((ut) => {
      const count = ut.topic._count.capturedTags;
      return `${ut.topic.name} (${count})`;
    })
    .join(", ");

  const positionsBlock =
    positions.length > 0
      ? positions.map((p) => `- ${p.topic.name}: "${p.statement}"`).join("\n")
      : "None yet.";

  const detailBlock = detailed
    .map((c) => {
      const title = captureTitle(c);
      const gist = captureGist(c);
      const idea = gist && gist !== title ? ` — ${gist}` : "";
      const take = c.reaction?.trim() ? ` (their take: ${truncate(c.reaction, 140)})` : "";
      return `${captureIndex.get(c.id)}. "${title}"${idea}${take}`;
    })
    .join("\n");

  // Everything not shown in detail, by title, under its strongest topic.
  const groups = new Map<string, string[]>();
  for (const c of captures) {
    if (detailedIds.has(c.id)) continue;
    const primary = [...c.topics].sort((a, b) => b.weight - a.weight)[0];
    const group = primary?.topic.name ?? "Unfiled";
    const line = `#${captureIndex.get(c.id)} ${truncate(captureTitle(c), INDEX_TITLE_CHARS)}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const indexBlock = Array.from(groups.entries())
    .map(([group, lines]) => `${group}: ${lines.join("; ")}`)
    .join("\n");

  const unlisted = totalCaptures - captures.length;
  const capturesHeading =
    detailed.length === captures.length
      ? `Captures (newest-first, all ${captures.length}):`
      : `Captures in detail (numbered newest-first; the ${detailed.length} most recent/relevant of ${totalCaptures}):`;

  const edgesBlock =
    edges.length > 0
      ? edges
          .map((e) => `- #${captureIndex.get(e.fromItemId)} ${e.type} #${captureIndex.get(e.toItemId)}`)
          .join("\n")
      : "No connections yet.";

  return [
    "--- KNOWLEDGE MAP ---",
    `Topics (${userTopics.length}): ${topicsLine || "none"}`,
    "",
    "Positions:",
    positionsBlock,
    "",
    capturesHeading,
    detailBlock,
    ...(indexBlock
      ? [
          "",
          `Rest of the map (titles only, by topic${unlisted > 0 ? `; ${unlisted} oldest captures not listed` : ""}):`,
          indexBlock,
        ]
      : []),
    "",
    "Connections:",
    edgesBlock,
    "--- END MAP ---",
  ].join("\n");
}

async function buildFocusBlock(
  userId: string,
  itemIds: string[],
  db: DbClient,
): Promise<string | undefined> {
  const items = await db.capturedItem.findMany({
    where: { id: { in: itemIds }, userId },
    select: {
      rawText: true,
      keyIdea: true,
      summary: true,
      userContext: true,
      contentItem: { select: { title: true, description: true } },
    },
  });
  if (items.length === 0) return undefined;

  const lines = items.map((it, i) => {
    const title = it.contentItem?.title ?? it.rawText?.slice(0, 80) ?? "Untitled";
    const gist = [it.keyIdea, it.userContext, it.summary, it.contentItem?.description, it.rawText]
      .find((part) => part && part.trim().length > 0)
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const idea = gist && gist !== title ? ` — ${gist}` : "";
    return `${i + 1}. "${title}"${idea}`;
  });

  return ["--- FOCUS FOR THIS REPLY ---", ...lines, "--- END FOCUS ---"].join("\n");
}

export async function getOrCreateCompanionThread(args: {
  userId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  const existing = await db.companionThread.findUnique({
    where: { userId: args.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (existing) return existing;

  return db.companionThread.create({
    data: {
      userId: args.userId,
      messages: {
        create: { role: "COMPANION", content: DEFAULT_OPENING },
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function addCompanionReply(args: {
  userId: string;
  content: string;
  contextItemIds?: string[];
  db?: DbClient;
}) {
  if (!args.content.trim()) {
    throw new AppError("EMPTY_REPLY", "Reply cannot be empty", 422);
  }

  const db = args.db ?? prisma;

  const thread = await db.companionThread.findUnique({
    where: { userId: args.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!thread) {
    throw new AppError("THREAD_NOT_FOUND", "Thread not found — call GET to initialise it", 404);
  }

  const [contextBlock, focusBlock] = await Promise.all([
    // Retrieval reads the previous user turn too, so a follow-up like "say
    // more about that" still pulls the captures the conversation is about.
    buildCompanionContext(
      args.userId,
      db,
      [thread.messages.filter((m) => m.role === "USER").at(-1)?.content, args.content.trim()]
        .filter(Boolean)
        .join("\n"),
    ),
    args.contextItemIds && args.contextItemIds.length > 0
      ? buildFocusBlock(args.userId, args.contextItemIds, db)
      : Promise.resolve(undefined),
  ]);

  const companionContent =
    (await generateCompanionResponse({
      contextBlock,
      focusBlock,
      // Only the recent turns: the knowledge-map context block carries the
      // durable state, so an ever-growing history just burns tokens.
      conversationHistory: thread.messages.slice(-16).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      userMessage: args.content.trim(),
    })) ?? "That's worth exploring — but push it one step further. What specific connection are you trying to trace?";

  const userContent = args.content.trim();

  const [userMessage, companionMessage] = await prisma.$transaction(async (tx: DbClient) => {
    const u = await tx.companionMessage.create({
      data: { threadId: thread.id, role: "USER", content: userContent },
    });
    const c = await tx.companionMessage.create({
      data: { threadId: thread.id, role: "COMPANION", content: companionContent },
    });
    await tx.companionThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
    return [u, c] as const;
  });

  return { userMessage, companionMessage };
}

/** "New chat": wipe the conversation and start over from the opening line.
 * The map itself is untouched — only the companion's memory of this chat. */
export async function resetCompanionThread(args: { userId: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  const thread = await getOrCreateCompanionThread({ userId: args.userId, db });

  await prisma.$transaction(async (tx: DbClient) => {
    await tx.companionMessage.deleteMany({ where: { threadId: thread.id } });
    await tx.companionMessage.create({
      data: { threadId: thread.id, role: "COMPANION", content: DEFAULT_OPENING },
    });
  });

  return getOrCreateCompanionThread({ userId: args.userId, db });
}
