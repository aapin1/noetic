/**
 * Page-sampled PDF text extraction for the capture pipeline.
 *
 * Insights need the gist of a document, not all of it. Reading every page of a
 * 300-page book pinned the capture path on CPU and then tripped the parse
 * timeout, so the capture degraded to thin — nothing at all, after the most
 * expensive extraction we do. Instead: a long document is sampled (opening,
 * closing, middle) and pages are read one at a time under a soft deadline, so
 * a slow document returns whatever has been read rather than nothing.
 */

/** Documents up to this many pages are read in full. */
export const PDF_FULL_READ_PAGES = 50;
/** Pages sampled from a long document: opening + closing + middle. */
const SAMPLE_HEAD_PAGES = 10;
const SAMPLE_TAIL_PAGES = 5;
const SAMPLE_MIDDLE_PAGES = 5;

/** Marks a run of skipped pages so the LLM knows material was elided. */
const ELISION = "\n[…]\n";

/**
 * Minimal slice of pdf.js's PDFDocumentProxy that extraction needs — kept
 * structural so tests can drive it with a fake.
 */
export type PdfPageSource = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
};

/**
 * Pages to read, in priority order: opening first (title, abstract, thesis),
 * then closing (conclusion), then the middle. Running out of time therefore
 * costs the least informative pages first. A document within the full-read
 * limit lists every page, still in that priority order.
 */
export function planPdfPages(numPages: number): number[] {
  if (numPages <= 0) return [];
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

  if (numPages <= PDF_FULL_READ_PAGES) {
    const head = range(1, Math.min(SAMPLE_HEAD_PAGES, numPages));
    const tail = range(Math.max(head.length + 1, numPages - SAMPLE_TAIL_PAGES + 1), numPages);
    const middle = range(head.length + 1, numPages - tail.length);
    return [...head, ...tail, ...middle];
  }

  const head = range(1, SAMPLE_HEAD_PAGES);
  const tail = range(numPages - SAMPLE_TAIL_PAGES + 1, numPages);
  const midStart = Math.floor(numPages / 2) - Math.floor(SAMPLE_MIDDLE_PAGES / 2);
  const middle = range(midStart, midStart + SAMPLE_MIDDLE_PAGES - 1);
  return [...head, ...tail, ...middle];
}

/** One page's text, whitespace-collapsed the way unpdf's mergePages does. */
async function readPageText(pdf: PdfPageSource, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return (content.items as { str?: unknown; hasEOL?: boolean }[])
    .filter((item) => typeof item.str === "string")
    .map((item) => (item.str as string) + (item.hasEOL ? "\n" : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the planned pages until the deadline, then assembles them in document
 * order with an elision marker wherever pages were skipped (sampled out, timed
 * out, or failed to parse) and after the last page when the document continues
 * beyond it. Never throws on a single bad page.
 */
export async function extractPdfTextSampled(
  pdf: PdfPageSource,
  options: { deadlineAt: number },
): Promise<{ text: string; totalPages: number; pagesRead: number }> {
  const byPage = new Map<number, string>();
  for (const pageNumber of planPdfPages(pdf.numPages)) {
    if (Date.now() >= options.deadlineAt) break;
    try {
      byPage.set(pageNumber, await readPageText(pdf, pageNumber));
    } catch {
      // A malformed page shouldn't void the document; the gap is marked below.
    }
  }

  const ordered = [...byPage.keys()].sort((a, b) => a - b);
  let text = "";
  let previous = 0;
  for (const pageNumber of ordered) {
    const pageText = byPage.get(pageNumber) ?? "";
    if (text.length > 0) text += pageNumber === previous + 1 ? "\n" : ELISION;
    text += pageText;
    previous = pageNumber;
  }
  // The document continues past the last page read (deadline hit mid-way).
  if (ordered.length > 0 && previous < pdf.numPages) text += ELISION.trimEnd();
  return { text, totalPages: pdf.numPages, pagesRead: ordered.length };
}
