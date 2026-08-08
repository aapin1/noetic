import { normalizeUrl } from "@/server/url";

/**
 * Pure parsing + planning for bulk link import. Deliberately free of prisma
 * and pipeline imports so the parsers unit-test as plain functions.
 *
 * Three source shapes: pasted text (URLs pulled liberally), browser-bookmarks
 * HTML (Netscape format — every anchor href), and a Pocket CSV export (the
 * `url` column). Anything unrecognisable falls back to the text parser.
 */

export const IMPORT_CAP = 200;

const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]]+/gi;

/** Trailing sentence punctuation that rides along when a URL ends a line. */
function trimTrailing(url: string): string {
  return url.replace(/[).,;:!?\]'"]+$/, "");
}

export function parsePastedText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const cleaned = trimTrailing(url);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      found.push(cleaned);
    }
  };

  for (const match of text.match(URL_PATTERN) ?? []) {
    push(match);
  }
  // Liberal: a bare "www.example.com/path" line still reads as intent.
  for (const token of text.split(/\s+/)) {
    if (/^www\.[^\s/]+\.[a-z]{2,}/i.test(token)) {
      push(`https://${token}`);
    }
  }
  return found;
}

export function parseBookmarksHtml(html: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const anchor = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (/^https?:\/\//i.test(href) && !seen.has(href)) {
      seen.add(href);
      found.push(href);
    }
  }
  return found;
}

/** Minimal CSV reader: quoted fields, escaped quotes, newlines inside quotes.
 * Malformed rows degrade to whatever cells they yield — never a throw. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function parsePocketCsv(csv: string): string[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const urlColumn = header.indexOf("url");
  const body = urlColumn >= 0 ? rows.slice(1) : rows;

  const found: string[] = [];
  const seen = new Set<string>();
  for (const cells of body) {
    const candidate =
      urlColumn >= 0
        ? cells[urlColumn]?.trim()
        : cells.find((cell) => /^https?:\/\//i.test(cell.trim()))?.trim();
    if (candidate && /^https?:\/\//i.test(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      found.push(candidate);
    }
  }
  return found;
}

export type ImportFormat = "bookmarks-html" | "pocket-csv" | "text";

export function detectImportFormat(content: string, filename?: string): ImportFormat {
  const name = (filename ?? "").toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm")) return "bookmarks-html";
  if (name.endsWith(".csv")) return "pocket-csv";

  const head = content.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith("<!doctype netscape") || head.startsWith("<")) return "bookmarks-html";
  const firstLine = head.split(/\r?\n/, 1)[0] ?? "";
  if (/(^|,)\s*"?url"?\s*(,|$)/.test(firstLine)) return "pocket-csv";
  return "text";
}

export function parseImportContent(content: string, filename?: string): string[] {
  switch (detectImportFormat(content, filename)) {
    case "bookmarks-html":
      return parseBookmarksHtml(content);
    case "pocket-csv":
      return parsePocketCsv(content);
    default:
      return parsePastedText(content);
  }
}

export type ImportPlan = {
  /** Normalized URLs to run through the capture pipeline, in input order. */
  toCapture: string[];
  /** Same URL appearing twice in the batch, or already on the user's map. */
  duplicates: number;
  /** Tokens that would not parse as a URL at all. */
  invalid: number;
  /** Valid new URLs beyond the per-import cap. */
  overCap: number;
};

/** Dedupe (within batch and against the caller-supplied set of already-captured
 * canonical URLs) and apply the cap. Pure — the DB read happens in import.ts. */
export function planImport(args: {
  urls: string[];
  existing: ReadonlySet<string>;
  cap?: number;
}): ImportPlan {
  const cap = args.cap ?? IMPORT_CAP;
  const seen = new Set<string>();
  const plan: ImportPlan = { toCapture: [], duplicates: 0, invalid: 0, overCap: 0 };

  for (const raw of args.urls) {
    let normalized: string;
    try {
      normalized = normalizeUrl(raw.trim());
    } catch {
      plan.invalid += 1;
      continue;
    }
    if (seen.has(normalized) || args.existing.has(normalized)) {
      plan.duplicates += 1;
      continue;
    }
    seen.add(normalized);
    if (plan.toCapture.length >= cap) {
      plan.overCap += 1;
      continue;
    }
    plan.toCapture.push(normalized);
  }
  return plan;
}
