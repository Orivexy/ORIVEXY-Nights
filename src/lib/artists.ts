import { normalizeSearch, slugify } from "./text";

/** Key that identifies an artist across sources: case, accents and spacing do not matter. */
export function artistKey(name: string): string {
  return normalizeSearch(name).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Cleans a line-up: trims, drops empty or overlong names and duplicates,
 * keeps the given order. Names are never invented, only cleaned.
 */
export function cleanLineup(names: Array<string | null | undefined>, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").replace(/\s+/g, " ").trim();
    const key = artistKey(name);
    if (!key || name.length > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export const artistSlugBase = (name: string) => slugify(name) || "artista";
