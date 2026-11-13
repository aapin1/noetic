import { describe, expect, it } from "vitest";
import { diagnoseBlockedSource } from "@/server/blocked-source";
import { parseMetadataFromHtml } from "@/server/metadata";

describe("diagnoseBlockedSource", () => {
  it("says nothing about a clean read, even on a walled host", () => {
    expect(diagnoseBlockedSource({ url: "https://www.facebook.com/x/posts/1", confidence: "rich" })).toBeUndefined();
  });

  it("names the login wall for Facebook and LinkedIn, including short links", () => {
    for (const url of ["https://www.facebook.com/share/p/abc/", "https://fb.watch/xyz", "https://m.facebook.com/story.php?id=1"]) {
      const d = diagnoseBlockedSource({ url, confidence: "thin" });
      expect(d?.reason).toBe("login_wall");
      expect(d?.message).toMatch(/^Facebook/);
    }
    expect(diagnoseBlockedSource({ url: "https://www.linkedin.com/posts/someone_abc", confidence: "partial" })?.message).toMatch(/^LinkedIn/);
    expect(diagnoseBlockedSource({ url: "https://lnkd.in/abc", confidence: "thin" })?.reason).toBe("login_wall");
  });

  it("calls a known news paywall a paywall and asks for the opening paragraphs", () => {
    const d = diagnoseBlockedSource({ url: "https://www.nytimes.com/2026/01/01/opinion/x.html", confidence: "partial" });
    expect(d?.reason).toBe("paywall");
    expect(d?.message).toContain("opening paragraphs");
  });

  it("trusts the page's own paywall flag on unlisted publishers", () => {
    expect(diagnoseBlockedSource({ url: "https://smallpaper.example/story", confidence: "thin", paywalled: true })?.reason).toBe("paywall");
  });

  it("doesn't match lookalike hosts", () => {
    expect(diagnoseBlockedSource({ url: "https://notft.com/a", confidence: "thin" })).toBeUndefined();
  });

  it("falls back to an article hint, then to nothing", () => {
    expect(diagnoseBlockedSource({ url: "https://blog.example/a", confidence: "thin", contentType: "article" })?.reason).toBe("unreadable_article");
    expect(diagnoseBlockedSource({ url: "https://shop.example/a", confidence: "thin", contentType: "link" })).toBeUndefined();
  });
});

describe("JSON-LD paywall flag", () => {
  const page = (ld: unknown) =>
    `<html><head><title>T</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;

  it("reads isAccessibleForFree false, as boolean or string, top-level or in hasPart", () => {
    expect(parseMetadataFromHtml(page({ "@type": "NewsArticle", isAccessibleForFree: false }), "https://a.example/x").paywalled).toBe(true);
    expect(parseMetadataFromHtml(page({ "@type": "NewsArticle", isAccessibleForFree: "False" }), "https://a.example/x").paywalled).toBe(true);
    expect(
      parseMetadataFromHtml(page({ "@type": "NewsArticle", hasPart: { "@type": "WebPageElement", isAccessibleForFree: false } }), "https://a.example/x").paywalled,
    ).toBe(true);
  });

  it("leaves free articles unflagged", () => {
    expect(parseMetadataFromHtml(page({ "@type": "NewsArticle", isAccessibleForFree: true }), "https://a.example/x").paywalled).toBeUndefined();
  });
});
