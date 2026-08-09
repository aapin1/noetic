import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";

/**
 * The blended archive search: text tiers plus the embedding layer. What these
 * pin is the contract, not the arithmetic — literal matches keep winning,
 * the semantic layer only ever adds recall and orders within a tier, and the
 * whole thing degrades to plain text search the moment the embed call fails.
 */

vi.mock("@/server/cognition/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cognition/llm")>();
  return { ...actual, embedText: vi.fn(async () => null) };
});

import { listCaptures } from "@/server/services/cognition";
import { embedText } from "@/server/cognition/llm";

const embedTextMock = vi.mocked(embedText);

const NOW = new Date("2026-08-08T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

type Row = ReturnType<typeof row>;

function row(
  id: string,
  ageDays: number,
  opts: { title?: string; rawText?: string } = {},
) {
  return {
    id,
    kind: "TEXT",
    capturedAt: daysAgo(ageDays),
    rawText: opts.rawText ?? null,
    caption: null,
    mediaUrl: null,
    reaction: null,
    userContext: null,
    summary: null,
    keyIdea: null,
    userTitle: null,
    contentItem: opts.title
      ? {
        id: `ci-${id}`,
        title: opts.title,
        description: null,
        canonicalUrl: null,
        siteName: null,
        imageUrl: null,
        authorName: null,
        source: null,
        contentType: null,
      }
      : null,
    topics: [],
    insights: [],
  };
}

/**
 * Three findMany shapes reach the fake: the text-filtered page (has a take and
 * the summary select), the embedding scan (selects only id + embedding), and
 * the by-id fetch for semantic hits. Told apart by what they select and where.
 */
function fakeDb(args: { textHits: Row[]; all: Row[]; embeddings?: Record<string, number[]> }): DbClient {
  const byId = new Map(args.all.map((r) => [r.id, r]));
  return {
    capturedItem: {
      findMany: vi.fn(async (q: {
        select: { embedding?: boolean };
        where: { id?: { in: string[] } };
      }) => {
        if (q.select.embedding) {
          return args.all.map((r) => ({ id: r.id, embedding: args.embeddings?.[r.id] ?? [] }));
        }
        if (q.where.id?.in) {
          return q.where.id.in.map((id) => byId.get(id)).filter(Boolean);
        }
        return args.textHits;
      }),
    },
  } as unknown as DbClient;
}

beforeEach(() => {
  embedTextMock.mockReset();
  embedTextMock.mockResolvedValue(null);
});

describe("listCaptures ranked search", () => {
  it("stands on plain text search when the embedding call fails", async () => {
    const hits = [row("a", 1, { title: "pasta night" }), row("b", 2, { rawText: "the pasta place" })];
    const db = fakeDb({ textHits: hits, all: hits });

    const results = await listCaptures({ userId: "u1", query: "pasta", db });

    expect(embedTextMock).toHaveBeenCalledOnce();
    // Prefix (80) over contains (50); no semantic layer anywhere.
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("finds a capture the text filter missed, below the literal matches", async () => {
    // "risotto" never says pasta, but its embedding sits next to the query's.
    const pasta = row("pasta", 5, { title: "pasta night" });
    const risotto = row("risotto", 1, { title: "a perfect risotto" });
    const db = fakeDb({
      textHits: [pasta],
      all: [pasta, risotto],
      embeddings: { pasta: [1, 0], risotto: [0.8, 0.6] },
    });
    embedTextMock.mockResolvedValue([1, 0]);

    const results = await listCaptures({ userId: "u1", query: "pasta", db });

    // sim(risotto) = 0.8 → semantic-only ≈ 32, well under the prefix tier.
    expect(results.map((r) => r.id)).toEqual(["pasta", "risotto"]);
  });

  it("keeps an exact match on top of a semantically closer contains match", async () => {
    const exact = row("exact", 10, { title: "pasta" });
    const closer = row("closer", 1, { rawText: "notes from pasta week" });
    const db = fakeDb({
      textHits: [exact, closer],
      all: [exact, closer],
      embeddings: { exact: [0, 1], closer: [1, 0] },
    });
    embedTextMock.mockResolvedValue([1, 0]);

    const results = await listCaptures({ userId: "u1", query: "pasta", db });

    // exact: 100 + 0 semantic; closer: 50 + full-cosine semantic (45) = 95.
    expect(results.map((r) => r.id)).toEqual(["exact", "closer"]);
  });

  it("leaves unrelated captures out, whatever their embedding noise", async () => {
    const pasta = row("pasta", 5, { title: "pasta night" });
    const taxes = row("taxes", 1, { title: "filing deadline" });
    const db = fakeDb({
      textHits: [pasta],
      all: [pasta, taxes],
      // cos = 0.2: below SEMANTIC_MIN_SIM, so no ticket in.
      embeddings: { pasta: [1, 0], taxes: [0.2, 0.9797958971] },
    });
    embedTextMock.mockResolvedValue([1, 0]);

    const results = await listCaptures({ userId: "u1", query: "pasta", db });

    expect(results.map((r) => r.id)).toEqual(["pasta"]);
  });

  it("uses semantic similarity to order equal text tiers", async () => {
    const near = row("near", 9, { rawText: "a pasta recipe worth keeping" });
    const far = row("far", 1, { rawText: "pasta mentioned in passing" });
    const db = fakeDb({
      textHits: [far, near],
      all: [far, near],
      embeddings: { near: [1, 0], far: [0.5, 0.8660254] },
    });
    embedTextMock.mockResolvedValue([1, 0]);

    const results = await listCaptures({ userId: "u1", query: "pasta", db });

    // Both contain (50); near's cosine 1.0 outranks far's 0.5 despite recency.
    expect(results.map((r) => r.id)).toEqual(["near", "far"]);
  });

  it("keeps cursor pages on the plain chronological path", async () => {
    const hits = [row("a", 1, { title: "pasta night" })];
    const db = fakeDb({ textHits: hits, all: hits });

    const results = await listCaptures({ userId: "u1", query: "pasta", cursor: "a", db });

    expect(embedTextMock).not.toHaveBeenCalled();
    expect(results.map((r) => r.id)).toEqual(["a"]);
  });
});
