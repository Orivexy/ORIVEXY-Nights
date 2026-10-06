import "server-only";
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { Connector, ExternalEvent, ExternalVenue, SourceDateTime } from "../types";

/**
 * ORIVEXY NIGHTS partner feed (JSON) — the format clubs and promoters can publish for
 * us. Documented in docs/event-discovery.md. Invalid items are skipped.
 */
const place = z.object({ name: z.string().max(120).optional(), address: z.string().max(200).optional(), lat: z.number().optional(), lng: z.number().optional() });
const eventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  start: z.string(),
  end: z.string().optional(),
  doors: z.string().optional(),
  timezone: z.string().optional(),
  venue: place.optional(),
  price: z.object({ min: z.number().min(0).optional(), max: z.number().min(0).optional(), currency: z.string().length(3).optional(), free: z.boolean().optional() }).optional(),
  ticketUrl: z.string().optional(),
  url: z.string().optional(),
  organizer: z.string().max(120).optional(),
  genres: z.array(z.string()).max(10).optional(),
  category: z.string().max(40).optional(),
  images: z.array(z.string()).max(5).optional(),
  status: z.enum(["scheduled", "cancelled"]).optional(),
});
const venueSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(1).max(120),
  address: z.string().max(200).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  phone: z.string().max(40).optional(),
  website: z.string().optional(),
  instagram: z.string().optional(),
  description: z.string().max(3000).optional(),
  genres: z.array(z.string()).optional(),
  images: z.array(z.string()).max(5).optional(),
});
const feedSchema = z.object({ version: z.literal(1), events: z.array(z.unknown()).optional(), venues: z.array(z.unknown()).optional() });

/** "2026-10-02T23:30:00+02:00" → instant; "2026-10-02T23:30" / "2026-10-02 23:30" → local wall time. */
function dateTime(v: string | undefined, tz: string): SourceDateTime | null {
  if (!v) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : { kind: "instant", iso: d.toISOString() };
  }
  const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? { kind: "local", date: m[1]!, time: m[2] ?? null, tz } : null;
}

async function loadFeed(url: string | null) {
  if (!url) throw new Error("La fuente necesita la URL del feed");
  const parsed = feedSchema.safeParse(await fetchJson<unknown>(url));
  if (!parsed.success) throw new Error("El feed no cumple el formato ORIVEXY NIGHTS v1");
  return parsed.data;
}

export const partnerFeedConnector: Connector = {
  label: "Feed de partner ORIVEXY NIGHTS (JSON)",
  async fetchEvents(ctx) {
    const feed = await loadFeed(ctx.url);
    const out: ExternalEvent[] = [];
    for (const raw of feed.events ?? []) {
      const r = eventSchema.safeParse(raw);
      if (!r.success) {
        ctx.log(`Evento ignorado: ${r.error.issues[0]?.message}`);
        continue;
      }
      const e = r.data;
      const tz = e.timezone ?? ctx.city.timezone;
      out.push({
        externalId: e.id,
        title: e.title,
        description: e.description,
        start: dateTime(e.start, tz),
        end: dateTime(e.end, tz),
        doors: dateTime(e.doors, tz),
        place: e.venue ?? null,
        priceMin: e.price?.min != null ? Math.round(e.price.min * 100) : null,
        priceMax: e.price?.max != null ? Math.round(e.price.max * 100) : null,
        currency: e.price?.currency,
        isFree: e.price?.free,
        ticketUrl: e.ticketUrl,
        officialUrl: e.url,
        sourceUrl: e.url,
        organizerName: e.organizer,
        genres: e.genres,
        categoryHint: e.category,
        imageUrls: e.images,
        cancelled: e.status === "cancelled",
      });
    }
    return out;
  },
  async fetchVenues(ctx) {
    const feed = await loadFeed(ctx.url);
    return (feed.venues ?? []).flatMap((raw): ExternalVenue[] => {
      const r = venueSchema.safeParse(raw);
      return r.success ? [{ externalId: r.data.id, ...r.data, imageUrls: r.data.images, sourceUrl: ctx.url }] : [];
    });
  },
};
