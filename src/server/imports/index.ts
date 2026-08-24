import { strFromU8, unzipSync } from "fflate";
import type { ProviderItem } from "@/server/connections/types";
import { BOOK_FORMATS } from "./formats-books";
import { FALLBACK_FORMAT, NOTE_FORMATS } from "./formats-notes";
import { SCREEN_FORMATS } from "./formats-screen";
import type { ImportFormat, ZipEntry } from "./types";

/**
 * One door for every file: detect what it is, parse it into provider items.
 * Order matters — specific headers before generic ones, and the bare URL
 * sweep last. A zip is opened and each file inside goes through the same
 * door, so a Letterboxd export, a Takeout, an Obsidian vault and a Medium
 * download all work without the person naming what they are.
 */
const FORMATS: ImportFormat[] = [...BOOK_FORMATS, ...SCREEN_FORMATS, ...NOTE_FORMATS];

export type ImportParse = {
  /** The formats that matched, as labels: ["letterboxd export"]. */
  formats: string[];
  items: ProviderItem[];
  /** Rows seen across every file, words or not. */
  seen: number;
  /** Files inside a zip we had no parser for. */
  skippedFiles: number;
};

const SKIP_IN_ZIP = /(^|\/)(\.|__MACOSX|node_modules)|\.(png|jpe?g|gif|webp|svg|mp3|mp4|m4a|mov|pdf|zip|ico|woff2?|ttf)$/i;
const ZIP_FILE_CAP = 2000;

export function detectFormat(text: string, filename?: string): ImportFormat {
  return FORMATS.find((f) => f.detect(text, filename)) ?? FALLBACK_FORMAT;
}

function parseOne(text: string, filename: string | undefined, out: ImportParse, formatsUsed: Set<string>): void {
  const format = detectFormat(text, filename);
  let result: { items: ProviderItem[]; seen: number };
  try {
    result = format.parse(text, filename);
  } catch {
    out.skippedFiles += 1;
    return;
  }
  if (result.items.length === 0 && result.seen === 0) {
    out.skippedFiles += 1;
    return;
  }
  formatsUsed.add(format.label);
  out.items.push(...result.items);
  out.seen += result.seen;
}

export function unzipEntries(bytes: Uint8Array): ZipEntry[] {
  const files = unzipSync(bytes, { filter: (f) => !SKIP_IN_ZIP.test(f.name) && !f.name.endsWith("/") && f.originalSize < 50_000_000 });
  return Object.entries(files)
    .slice(0, ZIP_FILE_CAP)
    .map(([name, data]) => ({ name, text: strFromU8(data) }));
}

/** Text or a zip (as bytes). */
export function parseImportFile(input: { text?: string; bytes?: Uint8Array; filename?: string }): ImportParse {
  const out: ImportParse = { formats: [], items: [], seen: 0, skippedFiles: 0 };
  const used = new Set<string>();
  if (input.bytes && (input.filename?.toLowerCase().endsWith(".zip") || (input.bytes[0] === 0x50 && input.bytes[1] === 0x4b))) {
    let entries: ZipEntry[];
    try {
      entries = unzipEntries(input.bytes);
    } catch {
      return out;
    }
    // A Medium export is all HTML; its `highlights/` folder is the only part that is the person's words.
    for (const e of entries) {
      if (/(^|\/)(html|medium-export)\/.*\.html$/i.test(e.name) && !/highlights|posts/i.test(e.name)) continue;
      parseOne(e.text, e.name, out, used);
    }
  } else {
    const text = input.text ?? (input.bytes ? strFromU8(input.bytes) : "");
    parseOne(text, input.filename, out, used);
  }
  // The same thing from two files (ratings.csv and diary.csv) collapses to one.
  const seenIds = new Set<string>();
  out.items = out.items.filter((i) => {
    const key = i.url || i.externalId;
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });
  out.formats = [...used];
  return out;
}

export { FORMATS };
