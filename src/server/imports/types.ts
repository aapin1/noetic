import type { ProviderItem } from "@/server/connections/types";

/**
 * A file export, parsed into the same shape a connected account produces.
 * `detect` is cheap (header line / filename); `parse` is pure.
 */
export type ImportFormat = {
  key: string;
  /** Lowercase, as shown on the import screen: "goodreads export". */
  label: string;
  detect: (text: string, filename?: string) => boolean;
  parse: (text: string, filename?: string) => { items: ProviderItem[]; seen: number };
};

/** What a zip unpacks to: one text entry per file we understand. */
export type ZipEntry = { name: string; text: string };
