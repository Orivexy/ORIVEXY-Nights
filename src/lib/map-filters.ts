import { opensDuring, openingStatus } from "./hours";
import { dateFilterWindow, eventEnd, type TimeWindow } from "./time";
import { distanceKm, type LatLng } from "./geo";
import { normalizeSearch } from "./text";
import type { MapEvent, MapPlace } from "./types";

/**
 * Map + list filtering (pure, shared by both so they always agree).
 * Nothing that already ended is shown; unknown prices never match a price
 * filter (they are "No disponible", not free).
 */

export type WhenFilter = "all" | "today" | "tomorrow" | "weekend" | "week";
export type PriceFilter = "any" | "free" | "lt10" | "10-20" | "20-30" | "30plus";
export type TypeFilter = "discoteca" | "club" | "fiesta" | "festival" | "concierto" | "evento";

export interface MapFilters {
  when: WhenFilter;
  price: PriceFilter;
  types: TypeFilter[];
  genres: string[];
  query: string;
  openNow: boolean;
}

export const DEFAULT_FILTERS: MapFilters = { when: "all", price: "any", types: [], genres: [], query: "", openNow: false };

export const WHEN_OPTIONS: Array<{ value: WhenFilter; label: string }> = [
  { value: "all", label: "Próximos" },
  { value: "today", label: "Hoy" },
  { value: "tomorrow", label: "Mañana" },
  { value: "weekend", label: "Este finde" },
  { value: "week", label: "7 días" },
];

export const PRICE_OPTIONS: Array<{ value: PriceFilter; label: string }> = [
  { value: "any", label: "Cualquier precio" },
  { value: "free", label: "Gratis" },
  { value: "lt10", label: "< 10 €" },
  { value: "10-20", label: "10–20 €" },
  { value: "20-30", label: "20–30 €" },
  { value: "30plus", label: "30 € +" },
];

export const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "discoteca", label: "Discotecas" },
  { value: "club", label: "Clubs" },
  { value: "concierto", label: "Conciertos" },
  { value: "fiesta", label: "Fiestas" },
  { value: "festival", label: "Festivales" },
  { value: "evento", label: "Eventos" },
];

/** Event category → filter type. */
export function eventType(category: string): TypeFilter {
  if (category === "festival") return "festival";
  if (category === "concierto") return "concierto";
  if (category === "fm" || category === "fiesta" || category === "dj" || category === "discoteca" || category === "tematica") return "fiesta";
  return "evento";
}

/** Kind of place → filter type (a place shows on its own under its kind). */
export function placeType(venueType: string | null): TypeFilter | null {
  switch (venueType) {
    case "DISCO":
      return "discoteca";
    case "CLUB":
      return "club";
    case "CONCERT_HALL":
      return "concierto";
    case "FESTIVAL_SPACE":
    case "OPEN_AIR":
      return "festival";
    case "EVENT_SPACE":
    case "OTHER":
      return "evento";
    default:
      return null;
  }
}

/** Does a price (cents, lowest price) fall in the bucket? null = unknown → never matches. */
export function priceMatches(priceMin: number | null, filter: PriceFilter): boolean {
  if (filter === "any") return true;
  if (priceMin == null) return false;
  const eur = priceMin / 100;
  switch (filter) {
    case "free":
      return priceMin === 0;
    case "lt10":
      return eur < 10;
    case "10-20":
      return eur >= 10 && eur <= 20;
    case "20-30":
      return eur > 20 && eur <= 30;
    case "30plus":
      return eur > 30;
  }
}

const HORIZON_DAYS = 60;

export function filterWindow(when: WhenFilter, tz: string, now = new Date()): TimeWindow {
  if (when === "all") return { from: now, to: new Date(now.getTime() + HORIZON_DAYS * 86400_000) };
  return dateFilterWindow(when, tz, now);
}

/** Not finished yet (events without end time count as running for 6 h). */
export function notEnded(e: Pick<MapEvent, "startsAt" | "endsAt" | "timeUnknown">, now = new Date()): boolean {
  return eventEnd(e.startsAt, e.endsAt, e.timeUnknown) > now;
}

export function isLive(e: Pick<MapEvent, "startsAt" | "endsAt" | "timeUnknown">, now = new Date()): boolean {
  return !e.timeUnknown && e.startsAt <= now && notEnded(e, now);
}

function inWindow(e: MapEvent, w: TimeWindow) {
  const end = eventEnd(e.startsAt, e.endsAt, e.timeUnknown);
  return e.startsAt < w.to && end > w.from;
}

export interface FilteredPlace {
  place: MapPlace;
  /** Events of the place that pass the filters, soonest first. */
  events: MapEvent[];
  live: boolean;
  open: boolean | null;
  distanceKm: number | null;
}

function textMatches(p: MapPlace, events: MapEvent[], terms: string[]) {
  if (!terms.length) return true;
  const hay = normalizeSearch([p.name, p.address, p.neighborhood, ...p.genres, ...events.flatMap((e) => [e.title, ...e.genres])].filter(Boolean).join(" "));
  return terms.every((t) => hay.includes(t));
}

export function filterPlaces(places: MapPlace[], f: MapFilters, opts: { now?: Date; coords?: LatLng | null; sortByDistance?: boolean } = {}): FilteredPlace[] {
  const now = opts.now ?? new Date();
  const terms = normalizeSearch(f.query).split(" ").filter((t) => t.length >= 2);
  const out: FilteredPlace[] = [];

  for (const p of places) {
    const w = filterWindow(f.when, p.timezone, now);
    const events = p.events.filter(
      (e) =>
        notEnded(e, now) &&
        inWindow(e, w) &&
        priceMatches(e.priceMin, f.price) &&
        (!f.genres.length || e.genres.some((g) => f.genres.includes(g)) || (p.kind === "venue" && p.genres.some((g) => f.genres.includes(g)))) &&
        (!f.types.length || f.types.includes(eventType(e.category)) || (p.kind === "venue" && f.types.includes(placeType(p.venueType)!))),
    );
    const status = p.kind === "venue" ? openingStatus(p.openingHours, p.timezone, now) : null;

    let visible: boolean;
    if (p.kind === "event") visible = events.length > 0;
    else {
      // A venue shows up with a matching event, or on its own when only
      // venue-level filters apply (opening hours for the date, genres, its usual price).
      const kind = placeType(p.venueType);
      const venueOnly =
        (!f.types.length || (kind != null && f.types.includes(kind))) &&
        (!f.genres.length || p.genres.some((g) => f.genres.includes(g))) &&
        (f.price === "any" || priceMatches(p.priceMin, f.price)) &&
        (f.when === "all" || opensDuring(p.openingHours, p.timezone, w.from, w.to));
      visible = events.length > 0 || venueOnly;
    }
    const live = events.some((e) => isLive(e, now));
    if (visible && f.openNow) visible = live || status?.open === true;
    if (!visible || !textMatches(p, events, terms)) continue;
    out.push({ place: p, events, live, open: status ? status.open : null, distanceKm: opts.coords ? distanceKm(opts.coords, p) : null });
  }

  if (opts.sortByDistance && opts.coords) out.sort((a, b) => a.distanceKm! - b.distanceKm!);
  else {
    const next = (x: FilteredPlace) => x.events[0]?.startsAt.getTime() ?? Number.POSITIVE_INFINITY;
    // Main places first, then what's on now, then the soonest.
    out.sort((a, b) => Number(Boolean(b.place.featured)) - Number(Boolean(a.place.featured)) || Number(b.live) - Number(a.live) || next(a) - next(b) || Number(b.open === true) - Number(a.open === true) || a.place.name.localeCompare(b.place.name, "es"));
  }
  return out;
}

export function activeFilterCount(f: MapFilters): number {
  return (f.price !== "any" ? 1 : 0) + f.types.length + f.genres.length + (f.openNow ? 1 : 0);
}

/**
 * "Cómo llegar": hands off to the device's maps app (Apple Maps on Apple
 * devices, the geo: chooser on Android, Google Maps on the web). ORIVEXY NIGHTS never
 * does turn-by-turn navigation itself.
 */
export function directionsUrl(to: LatLng & { name?: string }, userAgent = ""): string {
  const ll = `${to.lat},${to.lng}`;
  if (/iPhone|iPad|iPod|Macintosh/.test(userAgent)) return `https://maps.apple.com/?daddr=${ll}${to.name ? `&q=${encodeURIComponent(to.name)}` : ""}`;
  if (/Android/.test(userAgent)) return `geo:${ll}?q=${ll}${to.name ? `(${encodeURIComponent(to.name)})` : ""}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
}

/**
 * Cheapest known entry for a place: from its upcoming events' published
 * prices, else the venue's own usual price. Null when nobody published one
 * (shown as nothing, never guessed).
 */
export function lowestPrice(place: Pick<MapPlace, "priceMin">, events: Array<Pick<MapEvent, "priceMin">>): number | null {
  const known = events.map((e) => e.priceMin).filter((p): p is number => p != null);
  if (known.length) return Math.min(...known);
  return place.priceMin ?? null;
}

/** Best link to buy or check tickets for the next event (as published by its source). */
export function ticketLink(events: Array<Pick<MapEvent, "ticketUrl" | "officialUrl">>): { href: string; buy: boolean } | null {
  const withTickets = events.find((e) => e.ticketUrl);
  if (withTickets?.ticketUrl) return { href: withTickets.ticketUrl, buy: true };
  const official = events.find((e) => e.officialUrl);
  return official?.officialUrl ? { href: official.officialUrl, buy: false } : null;
}
