import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  captureSummarySelect,
  serializeCapturedItem,
  type CapturedItemSummary,
} from "@/server/services/cognition";

// The full-account read: the summary select plus every insight and edge. Still
// a narrow `select` — the embedding and scraped article bodies stay out of the
// export the same way they stay off every other read surface.
const exportSelect = {
  ...captureSummarySelect,
  insights: {
    select: { type: true, headline: true, body: true, strength: true },
    orderBy: { strength: "desc" },
  },
  edgesFrom: { select: { toItemId: true, type: true, weight: true } },
  edgesTo: { select: { fromItemId: true, type: true, weight: true } },
} satisfies Prisma.CapturedItemSelect;

export type ExportRow = Prisma.CapturedItemGetPayload<{ select: typeof exportSelect }>;

export type ExportCapture = {
  id: string;
  title: string;
  url: string | null;
  kind: CapturedItemSummary["kind"];
  keyIdea: string | null;
  userContext: string | null;
  reaction: string | null;
  summary: string | null;
  capturedAt: string;
  topics: { name: string; slug: string; weight: number }[];
  insights: { type: string; headline: string; body: string; strength: number }[];
  connections: { title: string; type: string; weight: number }[];
};

export type ExportPayload = {
  exportedAt: string;
  captureCount: number;
  captures: ExportCapture[];
  markdown: string;
};

/** Both edge directions merged into one neighbour list, strongest edge kept
 * per neighbour. Edges are written newer → older, so a connection lives on
 * `edgesFrom` of one node and `edgesTo` of the other. */
function neighbourEdges(row: ExportRow): { itemId: string; type: string; weight: number }[] {
  const strongest = new Map<string, { itemId: string; type: string; weight: number }>();
  const all = [
    ...row.edgesFrom.map((e) => ({ itemId: e.toItemId, type: e.type as string, weight: e.weight })),
    ...row.edgesTo.map((e) => ({ itemId: e.fromItemId, type: e.type as string, weight: e.weight })),
  ];
  for (const edge of all) {
    const held = strongest.get(edge.itemId);
    if (!held || edge.weight > held.weight) {
      strongest.set(edge.itemId, edge);
    }
  }
  return [...strongest.values()].sort((a, b) => b.weight - a.weight);
}

export function buildExport(rows: ExportRow[], exportedAt: Date): ExportPayload {
  const titles = new Map<string, string>();
  for (const row of rows) {
    titles.set(row.id, serializeCapturedItem(row).title);
  }

  const captures = rows.map((row): ExportCapture => {
    const base = serializeCapturedItem(row);
    return {
      id: base.id,
      title: base.title,
      url: base.contentItem?.canonicalUrl ?? null,
      kind: base.kind,
      keyIdea: base.keyIdea,
      userContext: base.userContext,
      reaction: base.reaction,
      summary: base.summary,
      capturedAt: base.capturedAt.toISOString(),
      topics: base.topics.map((t) => ({ name: t.name, slug: t.slug, weight: t.weight })),
      insights: row.insights.map((i) => ({
        type: i.type as string,
        headline: i.headline,
        body: i.body,
        strength: i.strength,
      })),
      connections: neighbourEdges(row)
        .filter((edge) => titles.has(edge.itemId))
        .map((edge) => ({ title: titles.get(edge.itemId)!, type: edge.type, weight: edge.weight })),
    };
  });

  return {
    exportedAt: exportedAt.toISOString(),
    captureCount: captures.length,
    captures,
    markdown: renderMarkdown(captures, exportedAt),
  };
}

/** A capture's home group in the document: its heaviest topic (the coarse
 * domain, by the weight convention), or "unfiled" when it has none. */
function primaryTopic(capture: ExportCapture): string {
  if (capture.topics.length === 0) return "unfiled";
  return [...capture.topics].sort((a, b) => b.weight - a.weight)[0].name;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function renderMarkdown(captures: ExportCapture[], exportedAt: Date): string {
  const lines: string[] = [];
  lines.push("# mneme export");
  lines.push("");
  lines.push(
    `${captures.length} capture${captures.length === 1 ? "" : "s"} · exported ${day(exportedAt.toISOString())}`,
  );

  const groups = new Map<string, ExportCapture[]>();
  for (const capture of captures) {
    const topic = primaryTopic(capture);
    const group = groups.get(topic) ?? [];
    group.push(capture);
    groups.set(topic, group);
  }

  // Biggest topics first; "unfiled" always last regardless of size.
  const names = [...groups.keys()].sort((a, b) => {
    if (a === "unfiled") return 1;
    if (b === "unfiled") return -1;
    const sizeDiff = groups.get(b)!.length - groups.get(a)!.length;
    return sizeDiff !== 0 ? sizeDiff : a.localeCompare(b);
  });

  for (const name of names) {
    lines.push("");
    lines.push(`## ${name}`);
    const group = [...groups.get(name)!].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    for (const capture of group) {
      lines.push("");
      lines.push(`### ${capture.title}`);
      if (capture.url) lines.push(capture.url);
      lines.push(`saved ${day(capture.capturedAt)}`);
      if (capture.keyIdea) lines.push(`- key idea: ${capture.keyIdea}`);
      if (capture.userContext) lines.push(`- your note: ${capture.userContext}`);
      if (capture.reaction) lines.push(`- reaction: ${capture.reaction}`);
      for (const connection of capture.connections) {
        lines.push(`- touches: ${connection.title} (${connection.type.toLowerCase()})`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function getExport(args: { userId: string; db?: DbClient }): Promise<ExportPayload> {
  const db = args.db ?? prisma;
  const rows = await db.capturedItem.findMany({
    where: { userId: args.userId },
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    select: exportSelect,
  });
  return buildExport(rows, new Date());
}
