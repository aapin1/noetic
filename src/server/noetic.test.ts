import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyEdge, draftInsights } from "@/server/cognition/insights";
import { polishInsights } from "@/server/cognition/llm";
import { extractKeyIdea, extractiveSummary, tokenize } from "@/server/cognition/terms";
import {
  captureSchema,
  captureUploadSchema,
  memoryGraphSchema,
  memoryTrendsSchema,
  onboardingProfileSchema,
  updatePreferencesSchema,
} from "@/server/contracts";
import { fetchMetadata } from "@/server/metadata";

describe("contracts", () => {
  it("validates onboarding 3-5 topics and optional identity fields", () => {
    expect(
      onboardingProfileSchema.parse({
        topics: ["philosophy", "systems", "design"],
        displayName: "Ada",
        insightStyle: "ANALYTICAL",
      }),
    ).toBeTruthy();
    expect(() => onboardingProfileSchema.parse({ topics: ["a", "b"] })).toThrow();
    expect(() => onboardingProfileSchema.parse({ topics: ["a", "b", "c", "d", "e", "f"] })).toThrow();
  });

  it("validates capture variants and memory schemas", () => {
    expect(captureSchema.parse({ kind: "LINK", url: "https://example.com" })).toBeTruthy();
    expect(captureSchema.parse({ kind: "IMAGE", caption: "note on screenshot" })).toBeTruthy();
    expect(() => captureSchema.parse({ kind: "TEXT" })).toThrow();
    expect(memoryGraphSchema.parse({}).limit).toBe(80);
    expect(memoryTrendsSchema.parse({}).window).toBe("week");
  });

  it("validates preference updates require at least one field", () => {
    expect(updatePreferencesSchema.parse({ insightStyle: "DIRECT" })).toBeTruthy();
    expect(updatePreferencesSchema.parse({ preferences: { compact: true } })).toBeTruthy();
    expect(() => updatePreferencesSchema.parse({})).toThrow();
  });

  it("validates capture upload schema shape", () => {
    const payload = "a".repeat(120);
    expect(captureUploadSchema.parse({ imageBase64: payload, mimeType: "image/png" })).toBeTruthy();
  });
});

describe("metadata fetch by platform URLs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches youtube metadata using oembed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: "Deep Learning Lecture",
        author_name: "MIT",
        thumbnail_url: "https://img.youtube.com/vi/abc/hqdefault.jpg",
        provider_name: "YouTube",
      }),
    } as Response));

    const result = await fetchMetadata("https://www.youtube.com/watch?v=abc");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.contentType).toBe("video");
    expect(result.metadata?.sourceDomain).toBe("youtube.com");
  });

  it("parses substack html metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html><head>
          <meta property="og:title" content="Substack Essay" />
          <meta property="og:description" content="Weekly note" />
          <meta property="og:url" content="https://writer.substack.com/p/essay" />
          <meta property="og:type" content="article" />
          <meta property="og:site_name" content="Substack" />
        </head></html>
      `,
    } as Response));

    const result = await fetchMetadata("https://writer.substack.com/p/essay?utm_source=feed");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.title).toBe("Substack Essay");
    expect(result.metadata?.contentType).toBe("article");
  });

  it("parses instagram html metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html><head>
          <meta property="og:title" content="Instagram post by noetic" />
          <meta property="og:url" content="https://www.instagram.com/p/ABC123/" />
          <meta property="og:description" content="Visual note" />
          <meta property="og:site_name" content="Instagram" />
        </head></html>
      `,
    } as Response));

    const result = await fetchMetadata("https://www.instagram.com/p/ABC123/?utm_source=ig_web_copy_link");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.sourceDomain).toBe("instagram.com");
    expect(result.metadata?.title).toContain("Instagram");
  });
});

describe("cognition helpers", () => {
  it("extracts summary and key idea", () => {
    const text = "Attention shapes memory. Repetition compounds patterns over time. Contradictions create deeper reflection.";
    const summary = extractiveSummary(text, 2);
    expect(summary.length).toBeGreaterThan(20);
    expect(summary).toContain("Repetition compounds patterns over time.");
    expect(extractKeyIdea(text).length).toBeGreaterThan(10);
    expect(tokenize("This is a clean-test, for tokenization!")).toContain("clean-test");
  });

  it("classifies edges and drafts insights", () => {
    expect(classifyEdge({ cosine: 0.5, topicJaccard: 0.5, polarityDelta: 0.01 })).toBe("RECURS");
    expect(classifyEdge({ cosine: 0.15, topicJaccard: 0.2, polarityDelta: 0.01 })).toBe("EVOLVES_FROM");

    const drafts = draftInsights({
      style: "DIRECT",
      itemTitle: "On cognitive drift",
      topicNames: ["philosophy"],
      topNeighbors: [{
        capturedItemId: "cap_1",
        title: "Prior thought",
        similarity: 0.7,
        topicJaccard: 0.6,
        edgeType: "RECURS",
        capturedAt: new Date(),
      }],
      topicCounts: [{ topicId: "t1", name: "philosophy", count: 4 }],
      shift: { topicId: "t1", name: "philosophy", recentCount: 3, priorCount: 1, delta: 2 },
      isFirstCapture: false,
    });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.some((d) => d.type === "PATTERN")).toBe(true);
  });

  it("falls back when llm polish fails", async () => {
    const drafts = [{ type: "NOVELTY", headline: "Old headline", body: "Body", evidence: {}, strength: 0.5 }] as const;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    process.env.OPENAI_API_KEY = "test-key";
    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "Title",
      drafts: [...drafts],
    });
    expect(result[0]?.headline).toBe("Old headline");
  });
});
