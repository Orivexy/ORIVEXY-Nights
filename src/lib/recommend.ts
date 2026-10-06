import { distanceKm, type LatLng } from "./geo";

/** What we know about the viewer's taste (all from their own activity). */
export interface TasteSignals {
  genres: Set<string>;
  venueIds: Set<string>;
  artistIds: Set<string>;
  coords?: LatLng | null;
}

export interface Candidate {
  id: string;
  startsAt: Date;
  lat: number;
  lng: number;
  venueId: string | null;
  genres: string[];
  artistIds: string[];
  interestedCount: number;
  goingCount: number;
  isFeatured: boolean;
}

export const WEIGHTS = { popularity: 1, proximity: 1.5, genre: 2, venue: 3, artist: 4, soon: 1, featured: 0.5 };

/**
 * Explainable ranking: popularity + proximity + taste (genres, followed venues
 * and artists) + how soon it is. No learning; every term is bounded so one
 * signal cannot swamp the rest.
 */
export function scoreEvent(e: Candidate, s: TasteSignals, now: Date): number {
  const popularity = Math.log1p(e.interestedCount + 2 * e.goingCount) / Math.log1p(200); // ~0–1
  const km = s.coords ? distanceKm(s.coords, e) : null;
  const proximity = km == null ? 0 : Math.max(0, 1 - km / 10); // 1 at the door, 0 beyond 10 km
  const genreHits = e.genres.filter((g) => s.genres.has(g)).length;
  const genre = Math.min(genreHits, 2) / 2;
  const venue = e.venueId && s.venueIds.has(e.venueId) ? 1 : 0;
  const artist = e.artistIds.some((a) => s.artistIds.has(a)) ? 1 : 0;
  const days = Math.max(0, (e.startsAt.getTime() - now.getTime()) / 86_400_000);
  const soon = Math.max(0, 1 - days / 14);
  return (
    WEIGHTS.popularity * Math.min(popularity, 1) +
    WEIGHTS.proximity * proximity +
    WEIGHTS.genre * genre +
    WEIGHTS.venue * venue +
    WEIGHTS.artist * artist +
    WEIGHTS.soon * soon +
    (e.isFeatured ? WEIGHTS.featured : 0)
  );
}

/** Does the viewer have enough taste signals for a personal ranking? */
export const hasTaste = (s: TasteSignals) => s.genres.size + s.venueIds.size + s.artistIds.size > 0;

export function rankEvents<T extends Candidate>(items: T[], s: TasteSignals, now: Date, limit: number): T[] {
  return items
    .map((e) => ({ e, score: scoreEvent(e, s, now) }))
    .sort((a, b) => b.score - a.score || a.e.startsAt.getTime() - b.e.startsAt.getTime())
    .slice(0, limit)
    .map(({ e }) => e);
}
