/**
 * schema.org JSON-LD extraction (the structured data sites publish for
 * search engines and aggregators). Supports Event subtypes and venue types.
 */
import type { ExternalEvent, ExternalPlace, ExternalVenue, SourceDateTime } from "../types";

const EVENT_TYPES = new Set(["Event", "MusicEvent", "DanceEvent", "Festival", "SocialEvent", "TheaterEvent", "ComedyEvent", "EducationEvent"]);
const VENUE_TYPES = new Set(["NightClub", "BarOrPub", "MusicVenue", "EventVenue", "LocalBusiness", "Place"]);

type Json = Record<string, unknown>;

export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]!.trim().replace(/^<!--|-->$/g, "")));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

/** Flattens arrays and @graph containers into a list of objects. */
export function flattenNodes(data: unknown): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Json;
      if (Array.isArray(o["@graph"])) walk(o["@graph"]);
      if (o["@type"]) out.push(o);
      if (o.itemListElement) walk((o.itemListElement as unknown[] | Json));
      if (o.item && typeof o.item === "object") walk(o.item);
      // A venue's page often lists its agenda inside the place (NightClub.event / events).
      for (const k of ["event", "events", "subEvent"]) if (o[k] && typeof o[k] === "object") walk(o[k]);
    }
  };
  walk(data);
  return out;
}

const types = (o: Json): string[] => (Array.isArray(o["@type"]) ? (o["@type"] as string[]) : [String(o["@type"])]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function parseSchemaDate(v: unknown, defaultTz: string): SourceDateTime | null {
  const s = str(v);
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : { kind: "instant", iso: d.toISOString() };
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? { kind: "local", date: m[1]!, time: m[2] ?? null, tz: defaultTz } : null;
}

function imageUrls(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(imageUrls);
  if (typeof v === "object") return str((v as Json).url) ? [str((v as Json).url)!] : [];
  return [];
}

function place(v: unknown): ExternalPlace | null {
  const o = (Array.isArray(v) ? v[0] : v) as Json | undefined;
  if (!o || typeof o !== "object") return typeof v === "string" ? { name: v } : null;
  const addr = o.address as Json | string | undefined;
  const geo = o.geo as Json | undefined;
  const address =
    typeof addr === "string"
      ? addr
      : addr
        ? [str(addr.streetAddress), str(addr.postalCode), str(addr.addressLocality)].filter(Boolean).join(", ") || null
        : null;
  return {
    name: str(o.name),
    address,
    city: typeof addr === "object" && addr ? str(addr.addressLocality) : null,
    lat: geo ? Number(geo.latitude) || null : null,
    lng: geo ? Number(geo.longitude) || null : null,
    imageUrl: imageUrls(o.image)[0] ?? null,
  };
}

/** The page's own share image (og:image), used when an event has no image in its data. */
export function ogImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m?.[1]?.startsWith("http") ? m[1].replace(/&amp;/g, "&") : null;
}

/** Price in cents from a schema.org Offer / AggregateOffer (only explicit numbers). */
function offers(v: unknown): { min: number | null; max: number | null; currency: string | null; url: string | null; free: boolean } {
  const list = (Array.isArray(v) ? v : v ? [v] : []) as Json[];
  const prices: number[] = [];
  let currency: string | null = null;
  let url: string | null = null;
  for (const o of list) {
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const n = Number(String(o[key] ?? "").replace(",", "."));
      if (o[key] !== undefined && o[key] !== "" && Number.isFinite(n) && n >= 0) prices.push(Math.round(n * 100));
    }
    currency ??= str(o.priceCurrency);
    url ??= str(o.url);
  }
  return {
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length > 1 ? Math.max(...prices) : null,
    currency,
    url,
    free: prices.length > 0 && Math.max(...prices) === 0,
  };
}

const atNightClub = (o: Json) => {
  const loc = (Array.isArray(o.location) ? o.location[0] : o.location) as Json | undefined;
  return Boolean(loc && typeof loc === "object" && types(loc).includes("NightClub"));
};

/** Events of the page; `nightClubsOnly` keeps those whose location is a schema.org NightClub. */
export function jsonLdToEvents(nodes: Json[], pageUrl: string, defaultTz: string, opts: { nightClubsOnly?: boolean; fallbackImage?: string | null } = {}): ExternalEvent[] {
  return nodes
    .filter((o) => types(o).some((t) => EVENT_TYPES.has(t)))
    .filter((o) => !opts.nightClubsOnly || atNightClub(o))
    .map((o) => {
      const off = offers(o.offers);
      const url = str(o.url);
      const name = str(o.name) ?? "";
      const start = parseSchemaDate(o.startDate, defaultTz);
      const organizer = (Array.isArray(o.organizer) ? o.organizer[0] : o.organizer) as Json | string | undefined;
      return {
        externalId: str(o["@id"]) ?? url ?? `${name}|${str(o.startDate)}`,
        title: name,
        description: str(o.description),
        start,
        end: parseSchemaDate(o.endDate, defaultTz),
        doors: parseSchemaDate(o.doorTime, defaultTz),
        place: place(o.location),
        priceMin: off.min,
        priceMax: off.max,
        currency: off.currency,
        isFree: off.free || o.isAccessibleForFree === true,
        ticketUrl: off.url,
        officialUrl: url,
        sourceUrl: url ?? pageUrl,
        organizerName: typeof organizer === "string" ? organizer : organizer ? str(organizer.name) : null,
        performers: [o.performer]
          .flat()
          .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? str((p as Json).name) : null))
          .filter((p): p is string => Boolean(p)),
        genres: [o.genre, (o as Json).keywords].flat().filter((g): g is string => typeof g === "string").flatMap((g) => g.split(",")),
        imageUrls: imageUrls(o.image).length ? imageUrls(o.image) : opts.fallbackImage ? [opts.fallbackImage] : [],
        cancelled: String(o.eventStatus ?? "").includes("EventCancelled"),
        categoryHint: atNightClub(o) ? "discoteca" : (types(o).find((t) => EVENT_TYPES.has(t)) ?? null),
      } satisfies ExternalEvent;
    });
}

export function jsonLdToVenues(nodes: Json[], pageUrl: string): ExternalVenue[] {
  return nodes
    .filter((o) => types(o).some((t) => VENUE_TYPES.has(t)) && str(o.name))
    .map((o) => {
      const p = place(o)!;
      const sameAs = (Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs]).filter((s): s is string => typeof s === "string");
      return {
        externalId: str(o["@id"]) ?? str(o.url) ?? `${str(o.name)}|${p.address}`,
        name: str(o.name)!,
        address: p.address ?? null,
        city: p.city ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        phone: str(o.telephone),
        website: str(o.url) ?? pageUrl,
        instagram: sameAs.find((s) => s.includes("instagram.com")) ?? null,
        description: str(o.description),
        types: types(o),
        imageUrls: imageUrls(o.image),
        sourceUrl: pageUrl,
      };
    });
}
