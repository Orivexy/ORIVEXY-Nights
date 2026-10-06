import "server-only";
import type { EventStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import { badRequest, notFound } from "../errors";
import { eventCardSelect, parseOffset, nextOffset, toEventCard, toUserMini, userMiniSelect } from "./mappers";
import { buildSearchText, normalizeSearch } from "@/lib/text";
import type { z } from "zod";
import type { venueAdminUpdateSchema } from "@/lib/validators";
import type { AppRole } from "@/lib/roles";
import { setUserSuspended } from "./reports";

/** Read models and actions for the admin panel (role-checked at the route). */

export async function adminStats() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const [users, newUsers, events, pendingEvents, venues, posts, openReports, suspended] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gt: since } } }),
    db.event.count({ where: { status: "PUBLISHED" } }),
    db.event.count({ where: { status: "PENDING" } }),
    db.venue.count({ where: { isActive: true } }),
    db.post.count({ where: { status: "VISIBLE" } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.user.count({ where: { status: "SUSPENDED" } }),
  ]);
  return { users, newUsers, events, pendingEvents, venues, posts, openReports, suspended };
}

const search = (q?: string) => (q ? normalizeSearch(q).slice(0, 60) : "");

export async function adminUsers(q?: string, cursor?: string, limit = 30) {
  const offset = parseOffset(cursor);
  const term = search(q);
  const rows = await db.user.findMany({
    where: term ? { OR: [{ email: { contains: term } }, { profile: { searchText: { contains: term } } }] } : {},
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, role: true, status: true, createdAt: true,
      profile: { select: { username: true, displayName: true, avatarKey: true, followerCount: true, postCount: true } },
      _count: { select: { events: true, reportsAgainst: true } },
    },
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit), nextCursor: nextOffset(offset, limit, rows.length) };
}

export async function adminEvents(opts: { q?: string; status?: EventStatus; imported?: boolean; cursor?: string; limit?: number }) {
  const limit = opts.limit ?? 30;
  const offset = parseOffset(opts.cursor);
  const term = search(opts.q);
  const where: Prisma.EventWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(term ? { searchText: { contains: term } } : {}),
    ...(opts.imported ? { source: "IMPORT" as const } : {}),
  };
  const rows = await db.event.findMany({
    where,
    orderBy: opts.status === "PENDING" ? { createdAt: "asc" } : { startsAt: "desc" },
    select: { ...eventCardSelect, organizer: { select: userMiniSelect }, createdAt: true, source: true, organizerName: true, _count: { select: { sourceRecords: true } }, city: { select: { name: true, timezone: true, country: { select: { currency: true } } } } },
    skip: offset,
    take: limit + 1,
  });
  return {
    items: rows.slice(0, limit).map((e) => ({ ...toEventCard(e), organizer: toUserMini(e.organizer), cityName: e.city.name, createdAt: e.createdAt, source: e.source, organizerName: e.organizerName, sourceCount: e._count.sourceRecords })),
    nextCursor: nextOffset(offset, limit, rows.length),
  };
}

export async function adminVenues(q?: string, cursor?: string, limit = 30) {
  const offset = parseOffset(cursor);
  const term = search(q);
  const rows = await db.venue.findMany({
    where: term ? { searchText: { contains: term } } : {},
    orderBy: { name: "asc" },
    select: {
      id: true, slug: true, name: true, address: true, neighborhood: true, lat: true, lng: true, description: true,
      priceMin: true, priceMax: true, minAge: true, website: true, instagram: true, isFeatured: true, isActive: true,
      ratingAvg: true, ratingCount: true, followerCount: true, coverKey: true,
      city: { select: { name: true } },
    },
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit), nextCursor: nextOffset(offset, limit, rows.length) };
}

export async function adminPosts(opts: { status?: "VISIBLE" | "HIDDEN" | "REMOVED"; cursor?: string; limit?: number }) {
  const limit = opts.limit ?? 30;
  const offset = parseOffset(opts.cursor);
  const rows = await db.post.findMany({
    where: opts.status ? { status: opts.status } : {},
    orderBy: { createdAt: "desc" },
    select: {
      id: true, type: true, caption: true, status: true, createdAt: true, likeCount: true, commentCount: true,
      author: { select: userMiniSelect },
      photos: { select: { key: true }, orderBy: { position: "asc" }, take: 1 },
      video: { select: { posterKey: true } },
      _count: { select: { reports: true } },
    },
    skip: offset,
    take: limit + 1,
  });
  return {
    items: rows.slice(0, limit).map((p) => ({
      ...p,
      author: toUserMini(p.author),
      thumbKey: p.photos[0]?.key ?? p.video?.posterKey ?? null,
    })),
    nextCursor: nextOffset(offset, limit, rows.length),
  };
}

export async function updateVenue(venueId: string, input: z.infer<typeof venueAdminUpdateSchema>) {
  const current = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { name: true, neighborhood: true, address: true, city: { select: { name: true } } } });
  const data: Prisma.VenueUpdateInput = { ...input, website: input.website === "" ? null : input.website };
  data.searchText = buildSearchText(
    input.name ?? current.name,
    input.neighborhood === undefined ? current.neighborhood : input.neighborhood,
    input.address ?? current.address,
    current.city.name,
  );
  return db.venue.update({ where: { id: venueId }, data, select: { id: true, slug: true } });
}

export async function setEventFeatured(eventId: string, featured: boolean) {
  await db.event.update({ where: { id: eventId }, data: { isFeatured: featured } });
}

export async function deleteEvent(eventId: string) {
  await db.event.delete({ where: { id: eventId } });
}

export async function setUserRole(userId: string, role: AppRole) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw notFound("Usuario no encontrado");
  if (user.role === "ADMIN" && role !== "ADMIN" && (await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })) <= 1) {
    throw badRequest("Debe quedar al menos un administrador");
  }
  await db.user.update({ where: { id: userId }, data: { role } });
}

/** Spam: the event is rejected and, when it comes from a regular community account, that account is suspended. */
export async function markEventSpam(eventId: string, actorRole: AppRole) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true, source: true, organizer: { select: { role: true } } } });
  if (!e) throw notFound("Evento no encontrado");
  await db.event.update({ where: { id: eventId }, data: { status: "REJECTED", isFeatured: false } });
  if (e.source === "USER" && e.organizer.role === "USER") await setUserSuspended(e.organizerId, true, actorRole);
}
