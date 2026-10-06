import "server-only";
import { notEndedWhere } from "./events";
import { db } from "../db";
import { eventCardSelect, toEventCard, toVenueCard, venueCardSelect } from "./mappers";
import type { Prisma } from "@prisma/client";
import { normalizeSearch } from "@/lib/text";
import { parseSearchIntent, type SearchIntent } from "@/lib/search-intent";
import { dateFilterWindow } from "@/lib/time";
import { boundingBox, distanceKm, type LatLng } from "@/lib/geo";
import { listCities, type CityData } from "./cities";
import { SYSTEM_USERNAMES } from "@/config/system";
import type { EventCardData, VenueCardData } from "@/lib/types";

export interface SearchResults {
  query: string;
  /** How the query was understood ("fiesta hoy" → type fiesta + today). */
  intent: SearchIntent;
  /** City searched (may differ from the current one: "techno Madrid"). */
  city: { slug: string; name: string };
  /** "cerca de mí" asked but no location shared yet. */
  needsLocation: boolean;
  events: EventCardData[];
  venues: VenueCardData[];
  users: Array<{ id: string; username: string; displayName: string; avatarKey: string | null; followerCount: number }>;
  places: Array<{ name: string; count: number; lat: number; lng: number }>;
  /** DJs and performers by name, with their upcoming dates. */
  artists: Array<{ id: string; slug: string; name: string; upcoming: number }>;
}

const TYPE_CATEGORIES: Record<string, string[]> = {
  fiesta: ["fiesta", "fm", "dj", "discoteca"],
  festival: ["festival"],
  concierto: ["concierto"],
  evento: ["otro"],
};

/**
 * Global search over events, venues, users and neighbourhoods, from the
 * database only. Understands intents ("fiesta hoy", "techno", "clubs cerca
 * de mí", "gratis este finde", "Barcelona"): dates, genres, types, price and
 * proximity become filters; remaining words must all match the maintained
 * `searchText` columns (accent/case-insensitive). Upcoming events only.
 */
export async function globalSearch(
  rawQuery: string,
  current: Pick<CityData, "id" | "slug" | "name" | "timezone">,
  opts: { limit?: number; coords?: LatLng | null; now?: Date } = {},
): Promise<SearchResults> {
  const limit = opts.limit ?? 8;
  const now = opts.now ?? new Date();
  const query = normalizeSearch(rawQuery).slice(0, 80);
  const cities = await listCities();
  const intent = parseSearchIntent(query, cities);
  const city = (intent.city && cities.find((c) => c.slug === intent.city)) || current;
  const terms = intent.text.split(" ").filter((t) => t.length >= 2).slice(0, 5);
  const hasFilters = Boolean(intent.when || intent.near || intent.free || intent.genres.length || intent.types.length || intent.city);
  const base = { query, intent, city: { slug: city.slug, name: city.name }, needsLocation: intent.near && !opts.coords };
  if (!terms.length && !hasFilters) return { ...base, events: [], venues: [], users: [], places: [], artists: [] };

  const near = intent.near && opts.coords ? { ...opts.coords, radiusKm: 3 } : null;
  const bbox = near ? boundingBox(near, near.radiusKm) : null;
  const text = terms.map((t) => ({ searchText: { contains: t } }));

  // Events
  const eventAnd: Prisma.EventWhereInput[] = [
    { cityId: city.id, status: "PUBLISHED" },
    notEndedWhere(now),
    ...text,
  ];
  if (intent.when) {
    const w = dateFilterWindow(intent.when, city.timezone, now);
    eventAnd.push({ OR: [{ startsAt: { gte: w.from, lt: w.to } }, { startsAt: { lt: w.from }, endsAt: { gt: w.from } }] });
  }
  if (intent.genres.length) eventAnd.push({ genres: { some: { genre: { slug: { in: intent.genres } } } } });
  const eventTypes = intent.types.filter((t) => t !== "club");
  if (eventTypes.length) eventAnd.push({ category: { slug: { in: eventTypes.flatMap((t) => TYPE_CATEGORIES[t] ?? []) } } });
  else if (intent.types.includes("club")) eventAnd.push({ venueId: { not: null } });
  if (intent.free) eventAnd.push({ priceMin: 0 });
  if (bbox) eventAnd.push({ lat: { gte: bbox.minLat, lte: bbox.maxLat }, lng: { gte: bbox.minLng, lte: bbox.maxLng } });

  // Venues (skipped when the query asks only for event types or free entry)
  const wantVenues = (!intent.types.length || intent.types.includes("club")) && !intent.free && !(intent.when && !terms.length && !intent.genres.length && !intent.near);
  const venueAnd: Prisma.VenueWhereInput[] = [{ cityId: city.id, isActive: true }, ...text];
  if (intent.genres.length) venueAnd.push({ genres: { some: { genre: { slug: { in: intent.genres } } } } });
  if (bbox) venueAnd.push({ lat: { gte: bbox.minLat, lte: bbox.maxLat }, lng: { gte: bbox.minLng, lte: bbox.maxLng } });

  const [events, venues, users, neighborhoods, artists] = await Promise.all([
    db.event.findMany({ where: { AND: eventAnd }, orderBy: { startsAt: "asc" }, select: eventCardSelect, take: near ? limit * 3 : limit }),
    wantVenues ? db.venue.findMany({ where: { AND: venueAnd }, orderBy: { followerCount: "desc" }, select: venueCardSelect, take: near ? limit * 3 : limit }) : [],
    terms.length && !hasFilters
      ? db.profile.findMany({
          where: { user: { status: "ACTIVE" }, username: { notIn: [...SYSTEM_USERNAMES] }, AND: text },
          orderBy: { followerCount: "desc" },
          select: { userId: true, username: true, displayName: true, avatarKey: true, followerCount: true },
          take: limit,
        })
      : [],
    terms.length
      ? db.venue.groupBy({
          by: ["neighborhood"],
          where: { cityId: city.id, isActive: true, neighborhood: { not: null } },
          _count: { _all: true },
          _avg: { lat: true, lng: true },
        })
      : [],
    terms.length && !intent.when && !intent.free
      ? db.artist.findMany({
          where: { AND: terms.map((t) => ({ nameKey: { contains: t } })) },
          orderBy: { followerCount: "desc" },
          take: limit,
          select: { id: true, slug: true, name: true, _count: { select: { events: { where: { event: { status: "PUBLISHED", ...notEndedWhere(now) } } } } } },
        })
      : [],
  ]);

  const places = neighborhoods
    .filter((n) => n.neighborhood && terms.every((t) => normalizeSearch(n.neighborhood!).includes(t)))
    .map((n) => ({ name: n.neighborhood!, count: n._count._all, lat: n._avg.lat ?? 0, lng: n._avg.lng ?? 0 }));

  const byDistance = <T extends LatLng>(items: T[]) =>
    near ? items.map((x) => ({ x, d: distanceKm(near, x) })).filter(({ d }) => d <= near.radiusKm).sort((a, b) => a.d - b.d).map(({ x }) => x).slice(0, limit) : items;

  return {
    ...base,
    events: byDistance(events.map(toEventCard)),
    venues: byDistance(venues.map(toVenueCard)),
    users: users.map(({ userId, ...u }) => ({ id: userId, ...u })),
    places,
    artists: artists.map(({ _count, ...a }) => ({ ...a, upcoming: _count.events })),
  };
}
