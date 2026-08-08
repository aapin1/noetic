import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { buildExport, getExport, renderMarkdown, type ExportRow } from "@/server/services/export";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const EXPORTED_AT = new Date("2026-08-08T06:00:00Z");

type TopicFixture = { id: string; name: string; slug: string };

const PHILOSOPHY: TopicFixture = { id: "t_philosophy", name: "philosophy", slug: "philosophy" };
const STOICISM: TopicFixture = { id: "t_stoicism", name: "Stoicism", slug: "stoicism" };

function topicRow(topic: TopicFixture, weight = 1) {
  return { topicId: topic.id, weight, topic };
}

/** Minimal ExportRow-shaped fixture — only the fields the serializer reads. */
function captureFixture(overrides: Partial<ExportRow> & { id: string }): ExportRow {
  return {
    kind: "TEXT",
    rawText: `text for ${overrides.id}`,
    caption: null,
    mediaUrl: null,
    reaction: null,
    userContext: null,
    summary: null,
    keyIdea: null,
    userTitle: null,
    capturedAt: new Date("2026-07-01T12:00:00Z"),
    contentItem: null,
    topics: [],
    insights: [],
    edgesFrom: [],
    edgesTo: [],
    ...overrides,
  } as ExportRow;
}

describe("buildExport", () => {
  it("returns an empty payload for an empty account", () => {
    const payload = buildExport([], EXPORTED_AT);

    expect(payload.captureCount).toBe(0);
    expect(payload.captures).toEqual([]);
    expect(payload.exportedAt).toBe("2026-08-08T06:00:00.000Z");
    expect(payload.markdown).toContain("# mneme export");
    expect(payload.markdown).toContain("0 captures · exported 2026-08-08");
  });

  it("shapes a capture with url, topics, insights, and iso dates", () => {
    const payload = buildExport(
      [
        captureFixture({
          id: "c1",
          kind: "LINK",
          userTitle: "my rename",
          reaction: "huh",
          userContext: "reminded me of dad",
          keyIdea: "memory is reconstructive",
          contentItem: {
            id: "ci1",
            title: "The Seven Sins of Memory",
            description: null,
            canonicalUrl: "https://example.com/memory",
            siteName: null,
            imageUrl: null,
            authorName: null,
            source: null,
            contentType: null,
          },
          topics: [topicRow(PHILOSOPHY, 2), topicRow(STOICISM, 1)],
          insights: [{ type: "PATTERN", headline: "a pattern", body: "the body", strength: 0.8 }],
        } as unknown as ExportRow),
      ],
      EXPORTED_AT,
    );

    expect(payload.captures).toHaveLength(1);
    const capture = payload.captures[0];
    expect(capture).toMatchObject({
      id: "c1",
      title: "my rename",
      url: "https://example.com/memory",
      kind: "LINK",
      keyIdea: "memory is reconstructive",
      userContext: "reminded me of dad",
      reaction: "huh",
      capturedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(capture.topics).toEqual([
      { name: "philosophy", slug: "philosophy", weight: 2 },
      { name: "Stoicism", slug: "stoicism", weight: 1 },
    ]);
    expect(capture.insights).toEqual([
      { type: "PATTERN", headline: "a pattern", body: "the body", strength: 0.8 },
    ]);
  });

  it("merges both edge directions into named connections, strongest per neighbour", () => {
    const rows = [
      captureFixture({
        id: "newer",
        rawText: "newer capture",
        edgesFrom: [
          { toItemId: "older", type: "RELATED", weight: 0.4 },
          { toItemId: "older", type: "CONTRADICTS", weight: 0.9 },
        ],
      } as unknown as ExportRow),
      captureFixture({
        id: "older",
        rawText: "older capture",
        edgesTo: [
          { fromItemId: "newer", type: "RELATED", weight: 0.4 },
          { fromItemId: "newer", type: "CONTRADICTS", weight: 0.9 },
        ],
      } as unknown as ExportRow),
    ];

    const payload = buildExport(rows, EXPORTED_AT);

    expect(payload.captures[0].connections).toEqual([
      { title: "older capture", type: "CONTRADICTS", weight: 0.9 },
    ]);
    expect(payload.captures[1].connections).toEqual([
      { title: "newer capture", type: "CONTRADICTS", weight: 0.9 },
    ]);
  });

  it("drops edges pointing at captures missing from the export", () => {
    const payload = buildExport(
      [
        captureFixture({
          id: "c1",
          edgesFrom: [{ toItemId: "ghost", type: "RELATED", weight: 0.5 }],
        } as unknown as ExportRow),
      ],
      EXPORTED_AT,
    );

    expect(payload.captures[0].connections).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it("groups captures under their heaviest topic, unfiled last", () => {
    const payload = buildExport(
      [
        captureFixture({
          id: "c1",
          rawText: "stoic capture",
          topics: [topicRow(PHILOSOPHY, 1), topicRow(STOICISM, 3)],
        } as unknown as ExportRow),
        captureFixture({
          id: "c2",
          rawText: "philosophy capture",
          topics: [topicRow(PHILOSOPHY, 2)],
        } as unknown as ExportRow),
        captureFixture({ id: "c3", rawText: "loose capture" }),
      ],
      EXPORTED_AT,
    );

    const markdown = payload.markdown;
    const stoicism = markdown.indexOf("## Stoicism");
    const philosophy = markdown.indexOf("## philosophy");
    const unfiled = markdown.indexOf("## unfiled");

    expect(stoicism).toBeGreaterThan(-1);
    expect(philosophy).toBeGreaterThan(-1);
    expect(unfiled).toBeGreaterThan(Math.max(stoicism, philosophy));
    expect(markdown.indexOf("stoic capture")).toBeGreaterThan(stoicism);
    expect(markdown.indexOf("stoic capture")).toBeLessThan(
      philosophy > stoicism ? philosophy : unfiled,
    );
  });

  it("writes one heading per capture with its fields as list lines", () => {
    const markdown = renderMarkdown(
      [
        {
          id: "c1",
          title: "A Title",
          url: "https://example.com/a",
          kind: "LINK",
          keyIdea: "the idea",
          userContext: "my note",
          reaction: "hm",
          summary: null,
          capturedAt: "2026-07-04T00:00:00.000Z",
          topics: [{ name: "philosophy", slug: "philosophy", weight: 1 }],
          insights: [],
          connections: [{ title: "Another", type: "CONTRADICTS", weight: 0.9 }],
        },
      ],
      EXPORTED_AT,
    );

    expect(markdown).toContain("### A Title");
    expect(markdown).toContain("https://example.com/a");
    expect(markdown).toContain("saved 2026-07-04");
    expect(markdown).toContain("- key idea: the idea");
    expect(markdown).toContain("- your note: my note");
    expect(markdown).toContain("- reaction: hm");
    expect(markdown).toContain("- touches: Another (contradicts)");
  });
});

describe("getExport", () => {
  it("queries the caller's captures and never selects the embedding", async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    const db = { capturedItem: { findMany } } as unknown as DbClient;

    const payload = await getExport({ userId: "u1", db });

    expect(payload.captureCount).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: unknown; select: Record<string, unknown> };
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.select.embedding).toBeUndefined();
    expect(args.select.insights).toBeDefined();
  });
});
