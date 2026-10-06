import "server-only";
import { db } from "../db";
import type { EventCardData } from "@/lib/types";
import type { LatLng } from "@/lib/geo";
import { hasTaste, rankEvents, type TasteSignals } from "@/lib/recommend";
import { eventCardSelect, toEventCard } from "./mappers";
import { notEndedWhere } from "./events";

/** Taste of a user, from what they chose and did: favourite genres, follows, saved and attended events. */
export async function tasteSignals(userId: string, coords?: LatLng | null): Promise<TasteSignals> {
  const [profile, venues, artists, saved, viewed] = await Promise.all([
    db.profile.findUnique({ where: { userId }, select: { favoriteGenres: true } }),
    db.venueFollow.findMany({ where: { userId }, select: { venueId: true }, take: 200 }),
    db.artistFollow.findMany({ where: { userId }, select: { artistId: true }, take: 200 }),
    db.event.findMany({
      where: { OR: [{ savedBy: { some: { userId } } }, { attendances: { some: { userId } } }] },
      orderBy: { startsAt: "desc" },
      take: 40,
      select: { genres: { select: { genre: { select: { slug: true } } } } },
    }),
    db.interaction.findMany({ where: { userId, type: "EVENT_VIEW", eventId: { not: null } }, orderBy: { createdAt: "desc" }, take: 30, select: { eventId: true } }),
  ]);
  const viewedGenres = viewed.length
    ? await db.eventGenre.findMany({ where: { eventId: { in: viewed.map((v) => v.eventId!) } }, select: { genre: { select: { slug: true } } } })
    : [];
  return {
    genres: new Set([...(profile?.favoriteGenres ?? []), ...saved.flatMap((e) => e.genres.map((g) => g.genre.slug)), ...viewedGenres.map((g) => g.genre.slug)]),
    venueIds: new Set(venues.map((v) => v.venueId)),
    artistIds: new Set(artists.map((a) => a.artistId)),
    coords: coords ?? null,
  };
}

/** "Para ti": upcoming events of the city ranked for this user; empty when we know nothing about them. */
export async function recommendedEvents(userId: string, cityId: string, opts: { coords?: LatLng | null; limit?: number; now?: Date } = {}): Promise<EventCardData[]> {
  const now = opts.now ?? new Date();
  const signals = await tasteSignals(userId, opts.coords);
  if (!hasTaste(signals)) return [];
  const rows = await db.event.findMany({
    where: { cityId, status: "PUBLISHED", ...notEndedWhere(now), startsAt: { lt: new Date(now.getTime() + 30 * 86_400_000) } },
    orderBy: { startsAt: "asc" },
    take: 300,
    select: { ...eventCardSelect, venueId: true, artists: { select: { artistId: true } } },
  });
  const ranked = rankEvents(
    rows.map((r) => ({ ...r, genres: r.genres.map((g) => g.genre.slug), artistIds: r.artists.map((a) => a.artistId), row: r })),
    signals,
    now,
    opts.limit ?? 12,
  );
  return ranked.map((r) => toEventCard(r.row));
}
