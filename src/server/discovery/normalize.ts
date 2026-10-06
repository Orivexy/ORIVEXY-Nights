/**
 * Turns connector output into ORIVEXY NIGHTS's uniform format. Pure functions — no
 * database, no network — so every rule is unit-tested.
 *
 * Principles: never invent data (unknown stays null), always resolve times
 * in the event's timezone, and keep titles readable.
 */
import { cleanLineup } from "@/lib/artists";
import { localToUtc } from "@/lib/time";
import { cleanText, normalizeSearch } from "@/lib/text";
import type { ExternalEvent, NormalizedEvent, SourceDateTime } from "./types";

// ─── Dates ──────────────────────────────────────────────────────────────────

export function resolveDateTime(v: SourceDateTime | null | undefined, fallbackTz: string, timeHint?: string | null): { date: Date; timeUnknown: boolean } | null {
  if (!v) return null;
  if (v.kind === "instant") {
    const d = new Date(v.iso);
    return Number.isNaN(d.getTime()) ? null : { date: d, timeUnknown: false };
  }
  const tz = v.tz || fallbackTz;
  const time = v.time ?? timeHint ?? null;
  try {
    const d = localToUtc(v.date, time ?? "00:00", tz);
    return Number.isNaN(d.getTime()) ? null : { date: d, timeUnknown: time == null };
  } catch {
    return null;
  }
}

/**
 * Nightlife ends are often "06:00" meaning the next morning. If the end is
 * not after the start, it belongs to the following day (Fri 23:30 → Sat 06:00).
 */
export function fixEndAfterStart(start: Date, end: Date | null): Date | null {
  if (!end) return null;
  let e = end;
  while (e.getTime() <= start.getTime() && e.getTime() > start.getTime() - 48 * 3600_000) {
    e = new Date(e.getTime() + 24 * 3600_000);
  }
  return e.getTime() > start.getTime() ? e : null;
}

// ─── Titles ─────────────────────────────────────────────────────────────────

const TIME_RE = /(?:^|[\s\-–|·@(])((?:[01]?\d|2[0-3])[:.h][0-5]\d)(?:\s*h)?(?=$|[\s)\-–|·])/i;
const SMALL_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "a", "of", "the", "and", "at", "i", "per", "amb"]);

function smartCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "");
  if (letters.length < 4 || upper.length / letters.length < 0.8) return s;
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w)) return w;
      const bare = w.replace(/[^\p{L}\d]/gu, "");
      if (i > 0 && SMALL_WORDS.has(bare)) return w;
      // Keep short all-caps tokens as acronyms (FM, DJ, B2B, BCN).
      if (bare.length > 0 && bare.length <= 3 && !SMALL_WORDS.has(bare)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join("");
}

export interface ParsedTitle {
  title: string;
  venueHint: string | null;
  timeHint: string | null;
}

/** "SATURDAY NIGHT @ CLUB XYZ - 23:30" → { title: "Saturday Night", venueHint: "Club XYZ", timeHint: "23:30" } */
export function parseTitle(raw: string): ParsedTitle {
  let s = cleanText(raw).replace(/\s+/g, " ");
  let timeHint: string | null = null;
  const t = s.match(TIME_RE);
  if (t) {
    timeHint = t[1]!.replace(/[.h]/i, ":").padStart(5, "0");
    s = s.replace(t[1]!, " ").replace(/\s*h\b/i, "");
  }
  let venueHint: string | null = null;
  const at = s.split(/\s+(?:@|at|en)\s+/i);
  if (at.length === 2 && at[1]!.trim().length >= 2) {
    s = at[0]!;
    venueHint = smartCase(at[1]!.replace(/[\s\-–|·,]+$/g, "").trim());
  }
  const title = smartCase(s.replace(/[\s\-–|·,]+$/g, "").replace(/^[\s\-–|·,]+/g, "").trim());
  return { title, venueHint: venueHint || null, timeHint };
}

// ─── Taxonomy ───────────────────────────────────────────────────────────────

const GENRE_KEYWORDS: Array<[string, RegExp]> = [
  ["techno", /\b(techno|tekno|hard ?techno|industrial)\b/],
  ["house", /\b(house|deep house|tech house|afro house)\b/],
  ["reggaeton", /\b(reggaeton|regueton|perreo|dembow)\b/],
  ["hip-hop", /\b(hip ?hop|rap|trap|r&b|rnb)\b/],
  ["comercial", /\b(comercial|commercial|hits|remember|mainstream)\b/],
  ["electronica", /\b(electronica|electronic|electro|drum ?(and|&|n) ?bass|dnb)\b/],
  ["edm", /\b(edm|big ?room|electro house)\b/],
  ["latin", /\b(latin|latino|latina|salsa|bachata|cumbia|merengue)\b/],
  ["indie", /\b(indie|rock|britpop|punk)\b/],
];

/** Genres only from explicit genre fields and the title (never guessed from long descriptions). */
export function detectGenres(explicit: string[] = [], title = ""): string[] {
  const haystack = normalizeSearch([...explicit, title].join(" | "));
  return GENRE_KEYWORDS.filter(([, re]) => re.test(haystack)).map(([slug]) => slug).slice(0, 4);
}

export function detectCategory(title: string, hint: string | null | undefined, atVenue: boolean): string {
  const t = normalizeSearch(`${title} ${hint ?? ""}`);
  if (/\b(festa major|fiesta mayor|festes de|fiestas de|\bfm\b)/.test(t)) return "fm";
  if (/\b(festival|fest)\b/.test(t)) return "festival";
  if (/\b(concierto|concert|en directo|live|gira|tour)\b/.test(t)) return "concierto";
  if (/\b(dj set|dj)\b/.test(t)) return "dj";
  if (/\b(tributo|tribute|tematica|theme party|halloween|carnaval|remember|revival|80s|90s|2000s|ochentas|noventas)\b/.test(t)) return "tematica";
  if (/\b(especial|special|gala|opening party|closing party|aniversario|anniversary|nochevieja|new year|fin de ano)\b/.test(t)) return "especial";
  if (/\b(discoteca|nightclub)\b/.test(normalizeSearch(hint ?? ""))) return "discoteca";
  return atVenue ? "discoteca" : "fiesta";
}

// ─── Misc ───────────────────────────────────────────────────────────────────

export function safeUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function stripHtml(v: string | null | undefined, max = 2000): string | null {
  if (!v) return null;
  const text = cleanText(
    v
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
  return text ? text.slice(0, max) : null;
}

const validCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export type NormalizeResult = { ok: true; event: NormalizedEvent } | { ok: false; reason: string };

export function normalizeEvent(ext: ExternalEvent, tz: string): NormalizeResult {
  const parsed = parseTitle(ext.title ?? "");
  if (!parsed.title) return { ok: false, reason: "Sin título" };
  if (ext.unsupported) return { ok: false, reason: ext.unsupported };

  const start = resolveDateTime(ext.start, tz, parsed.timeHint);
  if (!start) return { ok: false, reason: "Sin fecha válida" };
  const end = fixEndAfterStart(start.date, resolveDateTime(ext.end, tz)?.date ?? null);
  const doors = resolveDateTime(ext.doors, tz)?.date ?? null;

  const place = ext.place ?? {};
  const venueName = place.name?.trim() || parsed.venueHint;
  const hasCoords = validCoord(place.lat, place.lng);
  const priceMin = ext.isFree ? 0 : (ext.priceMin ?? null);

  return {
    ok: true,
    event: {
      title: parsed.title.slice(0, 120),
      description: stripHtml(ext.description),
      startsAt: start.date.toISOString(),
      endsAt: end?.toISOString() ?? null,
      doorsAt: doors && doors < start.date ? doors.toISOString() : null,
      timezone: tz,
      timeUnknown: start.timeUnknown,
      venueId: null,
      venueName: venueName ? venueName.slice(0, 80) : null,
      locationName: venueName ? venueName.slice(0, 80) : null,
      address: place.address?.trim().slice(0, 160) || null,
      lat: hasCoords ? place.lat! : null,
      lng: hasCoords ? place.lng! : null,
      priceMin,
      priceMax: ext.priceMax != null && priceMin != null && ext.priceMax > priceMin ? ext.priceMax : null,
      currency: ext.currency?.toUpperCase().slice(0, 3) || null,
      ticketUrl: safeUrl(ext.ticketUrl),
      officialUrl: safeUrl(ext.officialUrl),
      sourceUrl: safeUrl(ext.sourceUrl),
      organizerName: ext.organizerName?.trim().slice(0, 80) || null,
      performers: cleanLineup(ext.performers ?? []),
      genres: detectGenres(ext.genres, parsed.title),
      category: detectCategory(parsed.title, ext.categoryHint, Boolean(venueName)),
      imageUrls: (ext.imageUrls ?? []).map(safeUrl).filter((u): u is string => Boolean(u)).slice(0, 3),
      cancelled: Boolean(ext.cancelled),
    },
  };
}
