import { parseCsvRows } from "@/server/services/import-parse";

/**
 * A CSV/TSV as records keyed by lowercase header. Headers are normalised so
 * "My Review", "my_review" and "My review " all match "my review".
 */
export type Record_ = Record<string, string>;

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function tableRecords(text: string, delimiter = ","): { header: string[]; rows: Record_[] } {
  const rows = parseCsvRows(text.replace(/^﻿/, ""), delimiter);
  if (rows.length === 0) return { header: [], rows: [] };
  const header = rows[0].map(normalizeHeader);
  const out: Record_[] = [];
  for (const cells of rows.slice(1)) {
    const r: Record_ = {};
    header.forEach((h, i) => {
      r[h] = (cells[i] ?? "").trim();
    });
    out.push(r);
  }
  return { header, rows: out };
}

export function headerLine(text: string): string {
  return normalizeHeader((text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "").replace(/"/g, ""));
}

/** Does the header line carry every one of these column names? */
export function hasColumns(text: string, ...names: string[]): boolean {
  const line = headerLine(text);
  return names.every((n) => line.split(/[,\t]/).map((c) => c.trim()).includes(n));
}

export function pick(r: Record_, ...names: string[]): string {
  for (const n of names) {
    const v = r[n];
    if (v) return v;
  }
  return "";
}

/** Goodreads writes ISBNs as Excel formulas: ="0765312182". */
export function unformula(value: string): string {
  return value.replace(/^="?|"?$/g, "").trim();
}

export function year(value: string): number | undefined {
  const m = value.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

export function slugTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
