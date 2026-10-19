import { describe, expect, it } from "vitest";
import { extractPdfTextSampled, planPdfPages } from "@/server/pdf-text";

function fakePdf(pages: string[], opts: { delayMs?: number } = {}) {
  const read: number[] = [];
  return {
    read,
    pdf: {
      numPages: pages.length,
      getPage: async (n: number) => {
        read.push(n);
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        return {
          getTextContent: async () => ({
            items: [{ str: pages[n - 1], hasEOL: true }],
          }),
        };
      },
    },
  };
}

describe("planPdfPages", () => {
  it("reads every page of a short document, opening and closing first", () => {
    const plan = planPdfPages(6);
    expect([...plan].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan[0]).toBe(1);
    expect(plan.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("samples opening, middle, and closing pages of a long document", () => {
    const plan = planPdfPages(300);
    expect(plan.length).toBe(20);
    expect(plan.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Closing pages come before the middle: if the budget runs out, the
    // conclusion is already in hand.
    expect(plan.slice(10, 15)).toEqual([296, 297, 298, 299, 300]);
    expect(plan.slice(15)).toEqual([148, 149, 150, 151, 152]);
  });

  it("never repeats a page at the full-read boundary", () => {
    for (const n of [50, 51, 52, 60]) {
      const plan = planPdfPages(n);
      expect(new Set(plan).size).toBe(plan.length);
      expect(Math.max(...plan)).toBe(n);
    }
  });
});

describe("extractPdfTextSampled", () => {
  it("returns pages in document order with no elision for a short document", async () => {
    const { pdf, read } = fakePdf(["one alpha", "two beta", "three gamma"]);
    const result = await extractPdfTextSampled(pdf, { deadlineAt: Date.now() + 5000 });
    expect(result.text).toBe("one alpha\ntwo beta\nthree gamma");
    expect(result.totalPages).toBe(3);
    expect(result.pagesRead).toBe(3);
    expect(read.length).toBe(3);
  });

  it("marks skipped stretches of a long document and reads only the sample", async () => {
    const pages = Array.from({ length: 120 }, (_, i) => `page${i + 1} text`);
    const { pdf, read } = fakePdf(pages);
    const result = await extractPdfTextSampled(pdf, { deadlineAt: Date.now() + 5000 });
    expect(read.length).toBe(20);
    expect(result.text.startsWith("page1 text\npage2 text")).toBe(true);
    expect(result.text.endsWith("page119 text\npage120 text")).toBe(true);
    expect(result.text).toContain("page10 text\n[…]\npage58 text");
    expect(result.text).toContain("page62 text\n[…]\npage116 text");
  });

  it("stops at the deadline and keeps what it has read", async () => {
    const pages = Array.from({ length: 30 }, (_, i) => `page${i + 1} text`);
    const { pdf, read } = fakePdf(pages, { delayMs: 20 });
    const result = await extractPdfTextSampled(pdf, { deadlineAt: Date.now() + 100 });
    expect(read.length).toBeGreaterThan(0);
    expect(read.length).toBeLessThan(30);
    expect(result.pagesRead).toBe(read.length);
    expect(result.text.startsWith("page1 text")).toBe(true);
    expect(result.text).toContain("[…]");
  });

  it("survives a page that fails to parse", async () => {
    const { pdf } = fakePdf(["one", "two", "three"]);
    const broken = { ...pdf, getPage: async (n: number) => (n === 2 ? Promise.reject(new Error("bad page")) : pdf.getPage(n)) };
    const result = await extractPdfTextSampled(broken, { deadlineAt: Date.now() + 5000 });
    expect(result.text).toBe("one\n[…]\nthree");
    expect(result.pagesRead).toBe(2);
  });
});
