import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { artistKey, artistSlugBase, cleanLineup } from "@/lib/artists";
import { notFound } from "../errors";
import type { EventCardData } from "@/lib/types";
import { eventCardSelect, toEventCard } from "./mappers";
import { notEndedWhere } from "./events";

type Tx = Prisma.TransactionClient;

/** Ids of the artists with these names, creating the ones that do not exist yet. */
export async function upsertArtists(tx: Tx, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of cleanLineup(names)) {
    const nameKey = artistKey(name);
    const existing = await tx.artist.findUnique({ where: { nameKey }, select: { id: true } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const base = artistSlugBase(name);
    const taken = await tx.artist.findUnique({ where: { slug: base }, select: { id: true } });
    const created = await tx.artist.create({
      data: { name, nameKey, slug: taken ? `${base}-${randomBytes(2).toString("hex")}` : base },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

/** Replaces an event's line-up (order kept). */
export async function setEventArtists(tx: Tx, eventId: string, names: string[]) {
  const ids = await upsertArtists(tx, names);
  await tx.eventArtist.deleteMany({ where: { eventId } });
  if (ids.length) await tx.eventArtist.createMany({ data: ids.map((artistId, position) => ({ eventId, artistId, position })) });
}

export interface ArtistDetail {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  website: string | null;
  instagram: string | null;
  followerCount: number;
  following: boolean;
  upcoming: EventCardData[];
  past: EventCardData[];
}

export async function getArtist(slug: string, viewerId?: string | null): Promise<ArtistDetail | null> {
  const a = await db.artist.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, bio: true, website: true, instagram: true, followerCount: true },
  });
  if (!a) return null;
  const now = new Date();
  const published = { status: "PUBLISHED" as const, artists: { some: { artistId: a.id } } };
  const [upcoming, past, follow] = await Promise.all([
    db.event.findMany({ where: { ...published, ...notEndedWhere(now) }, orderBy: { startsAt: "asc" }, take: 24, select: eventCardSelect }),
    db.event.findMany({ where: { ...published, startsAt: { lt: now }, NOT: notEndedWhere(now) }, orderBy: { startsAt: "desc" }, take: 12, select: eventCardSelect }),
    viewerId ? db.artistFollow.findUnique({ where: { userId_artistId: { userId: viewerId, artistId: a.id } }, select: { userId: true } }) : null,
  ]);
  return { ...a, following: Boolean(follow), upcoming: upcoming.map(toEventCard), past: past.map(toEventCard) };
}

export async function toggleFollowArtist(userId: string, artistId: string, follow: boolean) {
  const exists = await db.artist.findUnique({ where: { id: artistId }, select: { id: true } });
  if (!exists) throw notFound("Artista no encontrado");
  return db.$transaction(async (tx) => {
    const prev = await tx.artistFollow.findUnique({ where: { userId_artistId: { userId, artistId } }, select: { userId: true } });
    if (follow && !prev) {
      await tx.artistFollow.create({ data: { userId, artistId } });
      await tx.artist.update({ where: { id: artistId }, data: { followerCount: { increment: 1 } } });
    } else if (!follow && prev) {
      await tx.artistFollow.delete({ where: { userId_artistId: { userId, artistId } } });
      await tx.artist.update({ where: { id: artistId }, data: { followerCount: { decrement: 1 } } });
    }
    const a = await tx.artist.findUniqueOrThrow({ where: { id: artistId }, select: { followerCount: true } });
    return { following: follow, followerCount: Math.max(0, a.followerCount) };
  });
}

export async function followedArtists(userId: string) {
  const rows = await db.artistFollow.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { artist: { select: { id: true, slug: true, name: true, followerCount: true } } },
  });
  return rows.map((r) => r.artist);
}
