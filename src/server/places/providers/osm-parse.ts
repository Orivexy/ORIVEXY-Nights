/**
 * OpenStreetMap → ProviderPlace (pure, unit-tested). OSM data is © its
 * contributors under the ODbL: it may be stored and shown on any map with
 * attribution.
 */
import { parseOsmOpeningHours } from "@/lib/hours";
import type { NightlifeCategory, PlaceArea, ProviderPlace } from "../types";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** OSM tags selected for each ORIVEXY NIGHTS category. */
export const OSM_FILTERS: Record<NightlifeCategory, string[]> = {
  nightclub: ['["amenity"="nightclub"]'],
  dance_club: ['["leisure"="dance"]["dance:teaching"!="yes"]'],
  music_venue: ['["amenity"="music_venue"]'],
  live_music_venue: ['["amenity"="bar"]["live_music"="yes"]', '["amenity"="pub"]["live_music"="yes"]'],
  event_venue: ['["amenity"="events_venue"]'],
  music_bar: [],
};

/**
 * Overpass QL for every category in the city's box (nodes, ways and
 * relations, with centres). A global bounding box is much cheaper for the
 * server than one `around` filter per category, so it answers even when busy.
 */
export function buildDiscoveryQuery(area: PlaceArea, categories: readonly NightlifeCategory[]): string {
  const r = Math.min(area.radiusKm, 50);
  const dLat = r / 111.32;
  const dLng = r / (111.32 * Math.cos((area.lat * Math.PI) / 180));
  const bbox = [area.lat - dLat, area.lng - dLng, area.lat + dLat, area.lng + dLng].map((v) => v.toFixed(5)).join(",");
  const parts = categories.flatMap((c) => OSM_FILTERS[c]).map((f) => `  nwr${f}["name"];`);
  return `[out:json][timeout:180][bbox:${bbox}];\n(\n${parts.join("\n")}\n);\nout center tags;`;
}

/** Overpass QL that re-reads elements by id ("node/1", "way/2"). */
export function buildRefreshQuery(ids: string[]): string | null {
  const byType: Record<string, string[]> = { node: [], way: [], relation: [] };
  for (const id of ids) {
    const m = id.match(/^(node|way|relation)\/(\d+)$/);
    if (m) byType[m[1]!]!.push(m[2]!);
  }
  const parts = Object.entries(byType).filter(([, v]) => v.length).map(([t, v]) => `  ${t}(id:${v.join(",")});`);
  return parts.length ? `[out:json][timeout:90];\n(\n${parts.join("\n")}\n);\nout center tags;` : null;
}

function categoriesOf(tags: Record<string, string>): NightlifeCategory[] {
  const out: NightlifeCategory[] = [];
  if (tags.amenity === "nightclub") out.push("nightclub");
  if (tags.leisure === "dance") out.push("dance_club");
  if (tags.amenity === "music_venue") out.push("music_venue");
  if ((tags.amenity === "bar" || tags.amenity === "pub") && tags.live_music === "yes") out.push("live_music_venue");
  if (tags.amenity === "events_venue") out.push("event_venue");
  return out;
}

function clean(v: string | undefined, max = 160): string | null {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function firstUrl(v: string | undefined): string | null {
  const raw = v?.split(";")[0]?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

function instagramOf(tags: Record<string, string>): string | null {
  const raw = tags["contact:instagram"] ?? tags.instagram;
  if (!raw) return null;
  const handle = raw.match(/instagram\.com\/([A-Za-z0-9_.]+)/)?.[1] ?? raw.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_.]{1,30}$/.test(handle) ? `@${handle}` : null;
}

/** "Carrer de Pamplona, 88, 08018 Barcelona" — only from address tags; null if there is no street. */
export function osmAddress(tags: Record<string, string>): string | null {
  const street = clean(tags["addr:street"] ?? tags["addr:place"]);
  if (!street) return clean(tags["addr:full"]);
  const line = [street, clean(tags["addr:housenumber"], 20)].filter(Boolean).join(", ");
  const city = [clean(tags["addr:postcode"], 10), clean(tags["addr:city"], 60)].filter(Boolean).join(" ");
  return [line, city].filter(Boolean).join(", ");
}

export function osmElementToPlace(el: OverpassElement): ProviderPlace | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const name = clean(tags.name, 80);
  const categories = categoriesOf(tags);
  // A place re-read by id that is now tagged disused:*/was:* has closed.
  const disused = Object.keys(tags).some((k) => /^(disused|abandoned|was|demolished):(amenity|leisure)$/.test(k));
  if (!name || (!categories.length && !disused)) return null;
  if (tags.access === "private") return null;
  return {
    providerId: `${el.type}/${el.id}`,
    name,
    address: osmAddress(tags),
    neighborhood: clean(tags["addr:suburb"] ?? tags["addr:neighbourhood"], 60),
    lat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
    lng: typeof lng === "number" && Number.isFinite(lng) ? lng : null,
    phone: clean(tags["contact:phone"] ?? tags.phone, 40)?.split(";")[0]?.trim() ?? null,
    website: firstUrl(tags["contact:website"] ?? tags.website ?? tags.url),
    instagram: instagramOf(tags),
    categories,
    hours: parseOsmOpeningHours(tags.opening_hours),
    businessStatus: disused ? "CLOSED_PERMANENTLY" : null,
    rating: null, // OSM has no ratings
    ratingCount: null,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

export function parseOverpass(json: { elements?: OverpassElement[] }): ProviderPlace[] {
  const seen = new Set<string>();
  const out: ProviderPlace[] = [];
  for (const el of json.elements ?? []) {
    const p = osmElementToPlace(el);
    if (!p || seen.has(p.providerId)) continue;
    seen.add(p.providerId);
    out.push(p);
  }
  return out;
}
