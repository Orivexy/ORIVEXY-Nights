import "server-only";
import { recordInteraction } from "./analytics";
import { setEventArtists } from "./artists";
import type { EventStatus, Prisma, VenueType } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { getSettings } from "../settings";
import { badRequest, forbidden, notFound } from "../http";
import type { SessionUser } from "../auth/session";
import { eventCardSelect, nextOffset, parseOffset, photoSelect, toEventCard, toUserMini, userMiniSelect } from "./mappers";
import { notifyMany, notify } from "./notifications";
import { getCityBySlug } from "./cities";
import { boundingBox, distanceKm, type LatLng } from "@/lib/geo";
import { buildSearchText, slugify } from "@/lib/text";
import { dateFilterWindow, localToUtc, type DateFilter, type TimeWindow } from "@/lib/time";
import type { EventCardData, EventDetail, Page, UserMini, ViewerEventState } from "@/lib/types";
import type { EventInput } from "@/lib/validators";
import { isStaff } from "@/lib/roles";
import { assertFeature } from "../monetization/flags";
import { businessForOrganizer } from "../monetization/business";
import { onEventCancelled } from "../monetization/refunds";

export type EventSort = "soonest" | "popular" | "newest";

export interface EventQuery {
  /** Omit to query across cities (e.g. a venue's own agenda). */
  cityId?: string;
  timezone: string;
  when?: DateFilter;
  window?: TimeWindow;
  categories?: string[];
  genres?: string[];
  /** Max price in cents; 0 = free only. */
  maxPrice?: number;
  near?: LatLng & { radiusKm: number };
  venueId?: string;
  /** Kinds of place (DISCO, CLUB…). */
  venueTypes?: string[];
  /** District of the place (zone). */
  district?: string;
  /** Free text over the event's title and its place's name. */
  q?: string;
  organizerId?: string;
  featured?: boolean;
  excludeIds?: string[];
  sort?: EventSort;
  cursor?: string;
  limit?: number;
}

/** Events that haven't finished yet (ongoing ones included). */
export function notEndedWhere(now: Date): Prisma.EventWhereInput {
  return {
    OR: [
      { endsAt: { gt: now } },
      { endsAt: null, timeUnknown: false, startsAt: { gt: new Date(now.getTime() - 6 * 3600_000) } },
      // Date without time: shown until the morning after its day.
      { endsAt: null, timeUnknown: true, startsAt: { gt: new Date(now.getTime() - 30 * 3600_000) } },
    ],
  };
}

export function buildEventWhere(q: EventQuery, now = new Date()): Prisma.EventWhereInput {
  const and: Prisma.EventWhereInput[] = [{ status: "PUBLISHED" }, notEndedWhere(now)];
  if (q.cityId) and.push({ cityId: q.cityId });

  const window = q.window ?? (q.when ? dateFilterWindow(q.when, q.timezone, now) : undefined);
  if (window) {
    // Starts inside the window, or is already running during it.
    and.push({
      OR: [
        { startsAt: { gte: window.from, lt: window.to } },
        { startsAt: { lt: window.from }, endsAt: { gt: window.from } },
      ],
    });
  }
  if (q.categories?.length) and.push({ category: { slug: { in: q.categories } } });
  if (q.genres?.length) and.push({ genres: { some: { genre: { slug: { in: q.genres } } } } });
  if (q.maxPrice !== undefined) and.push({ priceMin: q.maxPrice === 0 ? 0 : { lte: q.maxPrice } });
  if (q.venueId) and.push({ venueId: q.venueId });
  if (q.venueTypes?.length) and.push({ venue: { type: { in: q.venueTypes as VenueType[] } } });
  if (q.district) and.push({ venue: { district: q.district } });
  const text = q.q?.trim().slice(0, 80);
  if (text) and.push({ OR: [{ title: { contains: text, mode: "insensitive" } }, { venue: { name: { contains: text, mode: "insensitive" } } }, { locationName: { contains: text, mode: "insensitive" } }] });
  if (q.organizerId) and.push({ organizerId: q.organizerId });
  if (q.featured) and.push({ isFeatured: true });
  if (q.excludeIds?.length) and.push({ id: { notIn: q.excludeIds } });
  if (q.near) {
    const bb = boundingBox(q.near, q.near.radiusKm);
    and.push({ lat: { gte: bb.minLat, lte: bb.maxLat }, lng: { gte: bb.minLng, lte: bb.maxLng } });
  }
  return { AND: and };
}

function orderFor(sort: EventSort): Prisma.EventOrderByWithRelationInput[] {
  switch (sort) {
    case "popular":
      return [{ goingCount: "desc" }, { interestedCount: "desc" }, { startsAt: "asc" }];
    case "newest":
      return [{ createdAt: "desc" }];
    default:
      return [{ startsAt: "asc" }, { id: "asc" }];
  }
}

export async function listEvents(q: EventQuery): Promise<Page<EventCardData>> {
  const limit = q.limit ?? 12;
  const offset = parseOffset(q.cursor);
  const rows = await db.event.findMany({
    where: buildEventWhere(q),
    orderBy: orderFor(q.sort ?? "soonest"),
    select: eventCardSelect,
    skip: offset,
    take: limit + 1,
  });
  let items = rows.slice(0, limit).map(toEventCard);
  if (q.near) {
    // Exact radius + distance ordering on top of the bounding-box pre-filter.
    const near = q.near;
    items = items
      .map((e) => ({ e, d: distanceKm(near, e) }))
      .filter(({ d }) => d <= near.radiusKm)
      .sort((a, b) => a.d - b.d)
      .map(({ e }) => e);
  }
  return { items, nextCursor: nextOffset(offset, limit, rows.length) };
}

export async function viewerEventStates(userId: string | undefined, eventIds: string[]) {
  const map = new Map<string, ViewerEventState>();
  if (!userId || !eventIds.length) return map;
  const [att, saved] = await Promise.all([
    db.eventAttendance.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true, status: true } }),
    db.savedEvent.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true } }),
  ]);
  const savedSet = new Set(saved.map((s) => s.eventId));
  for (const id of eventIds) {
    map.set(id, { attendance: att.find((a) => a.eventId === id)?.status ?? null, saved: savedSet.has(id) });
  }
  return map;
}

function canEditEvent(user: SessionUser | null, organizerId: string) {
  return Boolean(user && (user.id === organizerId || isStaff(user.role)));
}

export async function getEventDetail(slug: string, viewer: SessionUser | null): Promise<EventDetail | null> {
  const e = await db.event.findUnique({
    where: { slug },
    select: {
      ...eventCardSelect,
      description: true,
      minAge: true,
      ticketUrl: true,
      source: true,
      organizerId: true,
      organizer: { select: userMiniSelect },
      organizerName: true,
      officialUrl: true,
      doorsAt: true,
      lastSyncedAt: true,
      sourceRecords: { where: { eventId: { not: null } }, select: { sourceUrl: true, source: { select: { name: true } } } },
      city: { select: { slug: true, name: true, timezone: true, country: { select: { currency: true } } } },
      photos: { where: { status: "VISIBLE" }, select: photoSelect, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 12 },
      artists: { orderBy: { position: "asc" }, select: { artist: { select: { id: true, slug: true, name: true } } } },
    },
  });
  if (!e) return null;
  // Unpublished events are visible only to their organizer and moderators.
  if (e.status !== "PUBLISHED" && !canEditEvent(viewer, e.organizerId)) return null;

  const [states, attendees] = await Promise.all([
    viewerEventStates(viewer?.id, [e.id]),
    attendeesPreview(e.id, viewer?.id),
  ]);

  return {
    ...toEventCard(e),
    description: e.description,
    minAge: e.minAge,
    ticketUrl: e.ticketUrl,
    organizer: e.source === "IMPORT" ? null : toUserMini(e.organizer),
    organizerName: e.organizerName,
    isOfficial: e.trust === "OFFICIAL",
    officialUrl: e.officialUrl,
    doorsAt: e.doorsAt,
    attribution:
      e.source === "IMPORT"
        ? { sources: e.sourceRecords.map((r) => ({ name: r.source.name, url: r.sourceUrl })), lastSyncedAt: e.lastSyncedAt }
        : null,
    city: { slug: e.city.slug, name: e.city.name },
    photos: e.photos,
    attendeesPreview: attendees,
    viewer: states.get(e.id) ?? { attendance: null, saved: false },
    canEdit: canEditEvent(viewer, e.organizerId),
    artists: e.artists.map((a) => a.artist),
  };
}

/** A few attendees to show as avatars, people the viewer follows first. */
async function attendeesPreview(eventId: string, viewerId?: string): Promise<UserMini[]> {
  const take = 6;
  const followed = viewerId
    ? await db.eventAttendance.findMany({
        where: { eventId, user: { followers: { some: { followerId: viewerId } } } },
        select: { user: { select: userMiniSelect } },
        take,
      })
    : [];
  const rest = await db.eventAttendance.findMany({
    where: { eventId, userId: { notIn: followed.map((f) => f.user.id) } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: { user: { select: userMiniSelect } },
    take: take - followed.length,
  });
  return [...followed, ...rest].map((a) => toUserMini(a.user));
}

export async function listAttendees(eventId: string, status: "INTERESTED" | "GOING", cursor?: string, limit = 30) {
  const offset = parseOffset(cursor);
  const rows = await db.eventAttendance.findMany({
    where: { eventId, status },
    orderBy: { createdAt: "desc" },
    select: { user: { select: userMiniSelect } },
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit).map((r) => toUserMini(r.user)), nextCursor: nextOffset(offset, limit, rows.length) };
}

async function uniqueEventSlug(title: string): Promise<string> {
  const base = slugify(title) || "evento";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function needsModeration(user: Pick<SessionUser, "role">, accountCreatedAt: Date): Promise<boolean> {
  if (isStaff(user.role)) return false;
  const { eventModeration } = await getSettings();
  if (eventModeration === "all") return true;
  if (eventModeration === "new_users") return Date.now() - accountCreatedAt.getTime() < 7 * 24 * 3600_000;
  return false;
}

/** Resolves and validates everything an event input references. */
async function resolveEventInput(user: SessionUser, input: EventInput, existingEventId?: string) {
  const city = await getCityBySlug(input.citySlug);
  if (!city) throw badRequest("Ciudad no válida", { citySlug: "Ciudad no válida" });

  const [category, genres, venue] = await Promise.all([
    db.category.findUnique({ where: { slug: input.category }, select: { id: true } }),
    db.musicGenre.findMany({ where: { slug: { in: input.genres } }, select: { id: true } }),
    input.venueId
      ? db.venue.findFirst({
          where: { id: input.venueId, cityId: city.id, isActive: true },
          select: { id: true, name: true, address: true, neighborhood: true, lat: true, lng: true, managers: { where: { id: user.id }, select: { id: true } } },
        })
      : null,
  ]);
  if (!category) throw badRequest("Categoría no válida");
  if (input.venueId && !venue) throw badRequest("Local no válido", { venueId: "Local no válido" });

  const startsAt = localToUtc(input.date, input.startTime, city.timezone);
  let endsAt: Date | null = null;
  if (input.endTime) {
    endsAt = localToUtc(input.date, input.endTime, city.timezone);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600_000); // ends after midnight
  }
  if (!existingEventId && startsAt.getTime() < Date.now() - 3600_000) {
    throw badRequest("La fecha ya ha pasado", { date: "La fecha ya ha pasado" });
  }
  if (startsAt.getTime() > Date.now() + 365 * 24 * 3600_000) {
    throw badRequest("La fecha es demasiado lejana", { date: "Máximo un año vista" });
  }

  // Photos must be the user's own, unattached uploads (or already on this event).
  const photoIds = [...new Set([...(input.coverPhotoId ? [input.coverPhotoId] : []), ...input.photoIds])];
  const photos = photoIds.length
    ? await db.photo.findMany({
        where: {
          id: { in: photoIds },
          OR: [
            { uploaderId: user.id, eventId: null, postId: null, venueId: null },
            ...(existingEventId ? [{ eventId: existingEventId }] : []),
          ],
        },
        select: { id: true, key: true },
      })
    : [];
  if (photos.length !== photoIds.length) throw badRequest("Alguna foto no es válida");
  const cover = input.coverPhotoId ? photos.find((p) => p.id === input.coverPhotoId) : photos[0];

  // Native ticket sales are not available yet; informative prices are.
  if (input.ticketing === "PLATFORM") assertFeature("tickets");

  return {
    city,
    categoryId: category.id,
    genreIds: genres.map((g) => g.id),
    venue,
    startsAt,
    endsAt,
    photoIds,
    coverKey: cover?.key ?? null,
    priceMin: input.isFree ? 0 : Math.round((input.price ?? 0) * 100),
    pricing: input.isFree ? ("FREE" as const) : ("PAID" as const),
    ticketProvider: input.ticketUrl ? ("EXTERNAL" as const) : ("NONE" as const),
    isVenueManager: Boolean(venue?.managers.length),
  };
}

export async function createEvent(user: SessionUser, input: EventInput) {
  const r = await resolveEventInput(user, input);
  const account = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } });
  // Owner and business are always derived from the session, never from the request.
  const businessId = await businessForOrganizer(user.id, r.venue?.id ?? null);
  // Verified organizers/venues publish official events without the review queue.
  const official = r.isVenueManager || Boolean(businessId);
  const status: EventStatus = input.draft ? "DRAFT" : !official && (await needsModeration(user, account.createdAt)) ? "PENDING" : "PUBLISHED";

  const event = await db.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        slug: await uniqueEventSlug(input.title),
        title: input.title,
        description: input.description,
        categoryId: r.categoryId,
        cityId: r.city.id,
        venueId: r.venue?.id ?? null,
        organizerId: user.id,
        locationName: r.venue?.name ?? input.locationName,
        address: r.venue?.address ?? input.address ?? null,
        lat: r.venue?.lat ?? input.lat,
        lng: r.venue?.lng ?? input.lng,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        priceMin: r.priceMin,
        pricing: r.pricing,
        ticketProvider: r.ticketProvider,
        capacity: input.capacity ?? null,
        refundPolicy: input.refundPolicy ?? null,
        minAge: input.minAge ?? null,
        ticketUrl: input.ticketUrl || null,
        coverKey: r.coverKey,
        status,
        source: r.isVenueManager ? "VENUE" : "USER",
        trust: official ? "OFFICIAL" : "COMMUNITY",
        businessId,
        searchText: buildSearchText(input.title, input.locationName, r.venue?.name, r.venue?.neighborhood, input.address, r.city.name, input.artists.join(" ")),
        genres: { create: r.genreIds.map((genreId) => ({ genreId })) },
      },
      select: { id: true, slug: true, status: true, venueId: true },
    });
    await setEventArtists(tx, created.id, input.artists);
    if (r.photoIds.length) {
      await Promise.all(
        r.photoIds.map((id, position) => tx.photo.update({ where: { id }, data: { eventId: created.id, position } })),
      );
    }
    return created;
  });

  if (event.status === "PUBLISHED") await notifyVenueFollowers(event.id, event.venueId, user.id);
  return event;
}

export async function updateEvent(user: SessionUser, eventId: string, input: EventInput) {
  const existing = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true, status: true } });
  if (!existing) throw notFound("Evento no encontrado");
  if (!canEditEvent(user, existing.organizerId)) throw forbidden();
  const r = await resolveEventInput(user, input, eventId);

  return db.$transaction(async (tx) => {
    await tx.eventGenre.deleteMany({ where: { eventId } });
    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description ?? null,
        categoryId: r.categoryId,
        cityId: r.city.id,
        venueId: r.venue?.id ?? null,
        locationName: r.venue?.name ?? input.locationName,
        address: r.venue?.address ?? input.address ?? null,
        lat: r.venue?.lat ?? input.lat,
        lng: r.venue?.lng ?? input.lng,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        priceMin: r.priceMin,
        pricing: r.pricing,
        ticketProvider: r.ticketProvider,
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.refundPolicy !== undefined ? { refundPolicy: input.refundPolicy } : {}),
        minAge: input.minAge ?? null,
        ticketUrl: input.ticketUrl || null,
        ...(r.coverKey ? { coverKey: r.coverKey } : {}),
        // Edits to rejected events go back to review.
        ...(existing.status === "REJECTED" ? { status: "PENDING" as const } : {}),
        reminderSentAt: null,
        searchText: buildSearchText(input.title, input.locationName, r.venue?.name, r.venue?.neighborhood, input.address, r.city.name, input.artists.join(" ")),
        genres: { create: r.genreIds.map((genreId) => ({ genreId })) },
      },
      select: { id: true, slug: true, status: true },
    });
    await setEventArtists(tx, eventId, input.artists);
    await Promise.all(
      r.photoIds.map((id, position) => tx.photo.update({ where: { id }, data: { eventId, position } })),
    );
    return updated;
  });
}

/** Sends a draft to publication: published or to review, with the same rules as a new event. */
export async function submitEvent(user: SessionUser, eventId: string) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true, status: true, venueId: true, businessId: true, trust: true } });
  if (!e) throw notFound("Evento no encontrado");
  if (!canEditEvent(user, e.organizerId)) throw forbidden();
  if (e.status !== "DRAFT") throw badRequest("Este evento ya se ha enviado");
  const account = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } });
  const official = e.trust === "OFFICIAL";
  const status: EventStatus = !official && (await needsModeration(user, account.createdAt)) ? "PENDING" : "PUBLISHED";
  const updated = await db.event.update({ where: { id: eventId }, data: { status }, select: { id: true, slug: true, status: true } });
  if (status === "PUBLISHED") await notifyVenueFollowers(eventId, e.venueId, user.id);
  return updated;
}

export async function cancelEvent(user: SessionUser, eventId: string) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
  if (!e) throw notFound("Evento no encontrado");
  if (!canEditEvent(user, e.organizerId)) throw forbidden();
  await db.event.update({ where: { id: eventId }, data: { status: "CANCELLED", salesStatus: "CLOSED" } });
  await onEventCancelled(eventId, user.id);
}

/** A new published event: tells the followers of its venue and of its artists (once each). */
export async function notifyVenueFollowers(eventId: string, venueId: string | null, actorId: string) {
  const [venueFollowers, artistFollowers] = await Promise.all([
    venueId ? db.venueFollow.findMany({ where: { venueId }, select: { userId: true }, take: 5000 }) : [],
    db.artistFollow.findMany({ where: { artist: { events: { some: { eventId } } } }, select: { userId: true }, take: 5000 }),
  ]);
  const byVenue = new Set(venueFollowers.map((f) => f.userId));
  await notifyMany([
    ...[...byVenue].map((userId) => ({ userId, actorId, type: "VENUE_NEW_EVENT" as const, eventId, dedupeKey: `venue_event:${eventId}:${userId}` })),
    ...[...new Set(artistFollowers.map((f) => f.userId))]
      .filter((userId) => !byVenue.has(userId))
      .map((userId) => ({ userId, actorId, type: "ARTIST_NEW_EVENT" as const, eventId, dedupeKey: `artist_event:${eventId}:${userId}` })),
  ]);
}

async function assertAttendable(eventId: string) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { status: true } });
  if (!e || e.status !== "PUBLISHED") throw notFound("Evento no encontrado");
}

/** Sets INTERESTED / GOING / none, keeping the event counters consistent. */
export async function setAttendance(userId: string, eventId: string, status: "INTERESTED" | "GOING" | null) {
  await assertAttendable(eventId);
  return db.$transaction(async (tx) => {
    const prev = await tx.eventAttendance.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { status: true } });
    const delta = { INTERESTED: 0, GOING: 0 };
    if (prev) delta[prev.status] -= 1;
    if (status) delta[status] += 1;

    if (status) {
      await tx.eventAttendance.upsert({
        where: { userId_eventId: { userId, eventId } },
        create: { userId, eventId, status },
        update: { status },
      });
    } else if (prev) {
      await tx.eventAttendance.delete({ where: { userId_eventId: { userId, eventId } } });
    }
    const updated = await tx.event.update({
      where: { id: eventId },
      data: { interestedCount: { increment: delta.INTERESTED }, goingCount: { increment: delta.GOING } },
      select: { interestedCount: true, goingCount: true },
    });
    return { status, ...updated };
  });
}

export async function toggleSaveEvent(userId: string, eventId: string, saved: boolean) {
  await assertAttendable(eventId);
  if (saved) {
    await db.savedEvent.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { userId, eventId },
      update: {},
    });
    recordInteraction({ type: "SAVE", userId, eventId });
  } else {
    await db.savedEvent.deleteMany({ where: { userId, eventId } });
  }
  return { saved };
}

export async function savedEvents(userId: string, cursor?: string, limit = 20): Promise<Page<EventCardData>> {
  const offset = parseOffset(cursor);
  const rows = await db.savedEvent.findMany({
    where: { userId, event: { status: { in: ["PUBLISHED", "CANCELLED"] } } },
    orderBy: { event: { startsAt: "asc" } },
    select: { event: { select: eventCardSelect } },
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit).map((r) => toEventCard(r.event)), nextCursor: nextOffset(offset, limit, rows.length) };
}

/** Events a user organises or attends — for profiles. */
export async function userEvents(userId: string, opts: { includeUnpublished: boolean; cursor?: string; limit?: number }) {
  const limit = opts.limit ?? 20;
  const offset = parseOffset(opts.cursor);
  const rows = await db.event.findMany({
    where: { organizerId: userId, ...(opts.includeUnpublished ? {} : { status: "PUBLISHED" }) },
    orderBy: { startsAt: "desc" },
    select: eventCardSelect,
    skip: offset,
    take: limit + 1,
  });
  return { items: rows.slice(0, limit).map(toEventCard), nextCursor: nextOffset(offset, limit, rows.length) };
}

/** Sends "your event starts in ~2 hours" to people going / interested. Idempotent. */
export async function sendEventReminders(now = new Date()) {
  const soon = await db.event.findMany({
    where: {
      status: "PUBLISHED",
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + 2 * 3600_000) },
    },
    select: { id: true, organizerId: true },
    take: 200,
  });
  let sent = 0;
  for (const event of soon) {
    const people = await db.eventAttendance.findMany({ where: { eventId: event.id }, select: { userId: true } });
    const recipients = new Set([event.organizerId, ...people.map((p) => p.userId)]);
    await notifyMany(
      [...recipients].map((userId) => ({
        userId,
        type: "EVENT_REMINDER" as const,
        eventId: event.id,
        dedupeKey: `reminder:${event.id}:${userId}`,
      })),
    );
    await db.event.update({ where: { id: event.id }, data: { reminderSentAt: now } });
    sent += recipients.size;
  }
  return { events: soon.length, notifications: sent };
}

/** Hides a published event (kept for history) or shows it again; no notification. */
export async function setEventHidden(eventId: string, hidden: boolean) {
  const e = await db.event.findUnique({ where: { id: eventId }, select: { status: true } });
  if (!e) throw notFound("Evento no encontrado");
  if (hidden ? e.status !== "PUBLISHED" : e.status !== "INACTIVE") throw badRequest(hidden ? "Solo se pueden ocultar eventos publicados" : "El evento no está oculto");
  await db.event.update({ where: { id: eventId }, data: { status: hidden ? "INACTIVE" : "PUBLISHED" } });
}

export async function moderateEvent(eventId: string, decision: "approve" | "reject") {
  const event = await db.event.update({
    where: { id: eventId },
    data: { status: decision === "approve" ? "PUBLISHED" : "REJECTED" },
    select: { id: true, organizerId: true, venueId: true },
  });
  await notify({
    userId: event.organizerId,
    type: decision === "approve" ? "EVENT_APPROVED" : "EVENT_REJECTED",
    eventId: event.id,
    dedupeKey: `moderation:${event.id}:${decision}:${Date.now()}`,
  });
  if (decision === "approve") await notifyVenueFollowers(event.id, event.venueId, event.organizerId);
}

/**
 * Discover filter options, straight from the database: every category and
 * genre, plus the city's venues that have upcoming events.
 */
export async function discoverFilterOptions(cityId: string, now = new Date()) {
  const [categories, genres, venues] = await Promise.all([
    db.category.findMany({ orderBy: { order: "asc" }, select: { slug: true, name: true } }),
    db.musicGenre.findMany({ orderBy: { order: "asc" }, select: { slug: true, name: true } }),
    db.venue.findMany({
      where: { cityId, isActive: true, events: { some: { status: "PUBLISHED", ...notEndedWhere(now) } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 200,
    }),
  ]);
  return { categories, genres, venues };
}
export type DiscoverFilterOptions = Awaited<ReturnType<typeof discoverFilterOptions>>;
