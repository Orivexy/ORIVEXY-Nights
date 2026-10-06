import "server-only";
import { randomBytes } from "node:crypto";
import type { DiscoverySource, Prisma } from "@prisma/client";
import { db } from "../db";
import { buildSearchText, slugify } from "@/lib/text";
import { sanitizeHours } from "@/lib/hours";
import { contentHash, loadCityVenues, matchVenue, type VenueCandidate } from "../discovery/store";
import { MISSED_SYNCS_TO_CLOSE, mayOverwrite, runLooksComplete, venueTypeFor } from "./rules";
import type { PlacePolicy, PlaceProvider, ProviderPlace } from "./types";

/**
 * APIs DE PLACES → DISCOVERY → NORMALIZACIÓN → DEDUPLICACIÓN → BD ORIVEXY NIGHTS
 *
 * Writes provider places into Venue rows, honouring each provider's policy:
 * providers that forbid storing content (Google) only link place IDs and
 * flag closures; storable providers (OSM, official pages) create and update
 * venues, record per-field change history and close places they no longer
 * list. Pages and the map read only from the database.
 */

export interface PlaceCounters {
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  queued: number;
  skipped: number;
  deactivated: number;
  errors: number;
}

type Source = Pick<DiscoverySource, "id" | "cityId" | "trust" | "venueId" | "autoPublish" | "eventsFound" | "name">;

const venueSelect = {
  id: true, name: true, address: true, neighborhood: true, lat: true, lng: true, phone: true, website: true, instagram: true,
  openingHours: true, categories: true, type: true, googlePlaceId: true, primarySourceId: true, trust: true,
  isActive: true, closedAt: true, inactiveReason: true, fieldUpdatedAt: true, sourceUrl: true,
} satisfies Prisma.VenueSelect;

type VenueRow = Prisma.VenueGetPayload<{ select: typeof venueSelect }>;

const str = (v: unknown) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));

/** Places from official pages / partner feeds (JSON-LD, etc.): storable. */
export const OWN_SOURCE_POLICY: PlacePolicy = { storeContent: true, coordinatesTtlDays: null, displayOnAnyMap: true, attribution: "", licenseUrl: "" };

export async function syncPlaces(
  source: Source,
  policy: PlacePolicy,
  places: ProviderPlace[],
  c: PlaceCounters,
  log: (l: string) => void,
  opts: { runStart: Date; nextSyncAt: Date; detectMissing: boolean; providerLabel: string },
) {
  c.found = places.length;
  const venues = await loadCityVenues(source.cityId);
  const cityName = (await db.city.findUniqueOrThrow({ where: { id: source.cityId }, select: { name: true } })).name;

  for (const place of places) {
    try {
      const result = policy.storeContent
        ? await upsertStorablePlace(place, source, venues, cityName, opts)
        : await linkRestrictedPlace(place, source, policy, venues, opts);
      c[result]++;
    } catch (err) {
      c.errors++;
      log(`${place.name ?? place.providerId}: ${(err as Error).message}`);
    }
  }

  if (opts.detectMissing) {
    if (runLooksComplete(places.length, source.eventsFound)) c.deactivated = await closeMissing(source, opts.runStart, opts.providerLabel);
    else log("Resultado incompleto o vacío: no se cierra ningún local por precaución");
  }
}

// ─── Storable providers (OSM, official pages) ───────────────────────────────

async function findVenue(place: ProviderPlace, source: Source, venues: VenueCandidate[]): Promise<VenueRow | null> {
  const record = await db.sourceVenueRecord.findUnique({
    where: { sourceId_externalId: { sourceId: source.id, externalId: place.providerId } },
    select: { venueId: true },
  });
  const id = record?.venueId ?? matchVenue(venues, place.name, place.lat, place.lng)?.id ?? null;
  return id ? db.venue.findUnique({ where: { id }, select: venueSelect }) : null;
}

async function upsertStorablePlace(
  place: ProviderPlace,
  source: Source,
  venues: VenueCandidate[],
  cityName: string,
  opts: { nextSyncAt: Date; providerLabel: string },
): Promise<"created" | "updated" | "unchanged" | "queued" | "skipped"> {
  const now = new Date();
  const hours = sanitizeHours(place.hours);
  const key = { sourceId_externalId: { sourceId: source.id, externalId: place.providerId } };
  const recordBase = { data: place as unknown as Prisma.InputJsonValue, contentHash: contentHash(place), lastSeenAt: now, missedSyncs: 0, expiresAt: null };
  const venue = await findVenue(place, source, venues);

  if (!venue) {
    const existing = await db.sourceVenueRecord.findUnique({ where: key, select: { reviewStatus: true } });
    if (existing?.reviewStatus === "REJECTED") {
      await db.sourceVenueRecord.update({ where: key, data: recordBase });
      return "skipped";
    }
    if (place.businessStatus === "CLOSED_PERMANENTLY") return "skipped";
    const reasons: string[] = [];
    if (!place.name) reasons.push("Sin nombre");
    if (place.lat == null || place.lng == null) reasons.push("Sin coordenadas");
    if (!place.categories.length) reasons.push("Sin categoría de ocio nocturno");
    if (!source.autoPublish) reasons.push("Fuente con revisión manual");
    if (reasons.length) {
      await db.sourceVenueRecord.upsert({ where: key, create: { ...key.sourceId_externalId, ...recordBase, reviewStatus: "PENDING", reviewReasons: reasons }, update: { ...recordBase, reviewReasons: reasons } });
      return "queued";
    }
    const created = await createVenueFromPlace(place, source, cityName, opts.nextSyncAt);
    venues.push(created);
    await db.sourceVenueRecord.upsert({ where: key, create: { ...key.sourceId_externalId, ...recordBase, venueId: created.id, reviewStatus: "AUTO", reviewReasons: [] }, update: { ...recordBase, venueId: created.id, reviewStatus: "AUTO", reviewReasons: [] } });
    return "created";
  }

  const overwrite = mayOverwrite({ sourceId: source.id, sourceTrust: source.trust, sourceVenueId: source.venueId, venue });
  const data: Prisma.VenueUncheckedUpdateInput = {};
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  const set = (field: string, current: unknown, incoming: unknown) => {
    if (incoming == null || incoming === "" || str(current) === str(incoming)) return;
    if (!overwrite && current != null && current !== "") return; // other sources only fill gaps
    (data as Record<string, unknown>)[field] = incoming;
    changes.push({ field, oldValue: str(current), newValue: str(incoming) });
  };
  set("name", venue.name, overwrite ? place.name : null);
  set("address", venue.address, place.address);
  set("neighborhood", venue.neighborhood, place.neighborhood);
  if (overwrite && place.lat != null && place.lng != null && (Math.abs(place.lat - venue.lat) > 1e-5 || Math.abs(place.lng - venue.lng) > 1e-5)) {
    data.lat = place.lat;
    data.lng = place.lng;
    changes.push({ field: "location", oldValue: `${venue.lat},${venue.lng}`, newValue: `${place.lat},${place.lng}` });
  }
  set("phone", venue.phone, place.phone);
  set("website", venue.website, place.website);
  set("instagram", venue.instagram, place.instagram);
  set("openingHours", venue.openingHours, hours);
  set("sourceUrl", venue.sourceUrl, overwrite ? place.sourceUrl : null);
  const mergedCategories = [...new Set([...venue.categories, ...place.categories])];
  if (mergedCategories.length !== venue.categories.length) data.categories = mergedCategories;

  // Closed / reopened according to the source.
  if (place.businessStatus === "CLOSED_PERMANENTLY" && venue.isActive) {
    if (overwrite && venue.trust === "IMPORTED") {
      Object.assign(data, { isActive: false, closedAt: now, inactiveReason: `Cerrado según ${opts.providerLabel}` });
      changes.push({ field: "isActive", oldValue: "true", newValue: "false" });
    } else {
      await flagRecord(key, `${opts.providerLabel} indica cierre definitivo: revisar`);
    }
  } else if (place.businessStatus !== "CLOSED_PERMANENTLY" && !venue.isActive && venue.closedAt && overwrite) {
    Object.assign(data, { isActive: true, closedAt: null, inactiveReason: null });
    changes.push({ field: "isActive", oldValue: "false", newValue: "true" });
  }

  const fieldUpdatedAt = { ...((venue.fieldUpdatedAt as Record<string, string> | null) ?? {}) };
  for (const ch of changes) fieldUpdatedAt[ch.field] = now.toISOString();
  if (changes.some((ch) => ch.field === "openingHours")) Object.assign(data, { hoursUpdatedAt: now, hoursSource: "source" });
  if (data.name || data.address || data.neighborhood) {
    data.searchText = buildSearchText((data.name as string) ?? venue.name, (data.address as string) ?? venue.address, (data.neighborhood as string) ?? venue.neighborhood, cityName);
  }
  if (overwrite && data.categories) data.type = venueTypeFor(data.categories as string[]);

  await db.$transaction([
    db.venue.update({
      where: { id: venue.id },
      data: {
        ...data,
        ...(changes.length ? { fieldUpdatedAt } : {}),
        lastSyncedAt: now,
        lastVerifiedAt: now,
        nextSyncAt: opts.nextSyncAt,
        ...(!venue.primarySourceId && venue.trust === "IMPORTED" ? { primarySourceId: source.id } : {}),
      },
    }),
    db.venueChange.createMany({ data: changes.map((ch) => ({ ...ch, venueId: venue.id, sourceId: source.id })) }),
    db.sourceVenueRecord.upsert({
      where: key,
      create: { ...key.sourceId_externalId, ...recordBase, venueId: venue.id, reviewStatus: "AUTO", reviewReasons: [] },
      update: { ...recordBase, venueId: venue.id },
    }),
  ]);
  return changes.length ? "updated" : "unchanged";
}

/** Creates a venue from a storable place (auto-publish or staff approval). */
export async function createVenueFromPlace(place: ProviderPlace, source: Pick<Source, "id" | "cityId" | "trust">, cityName: string, nextSyncAt: Date | null = null) {
  if (!place.name || place.lat == null || place.lng == null) throw new Error("El local necesita nombre y coordenadas");
  const now = new Date();
  const hours = sanitizeHours(place.hours);
  return db.venue.create({
    data: {
      slug: `${slugify(place.name) || "local"}-${randomBytes(2).toString("hex")}`,
      name: place.name,
      type: venueTypeFor(place.categories),
      categories: place.categories,
      cityId: source.cityId,
      address: place.address ?? "", // "" = unknown, shown as "Dirección no disponible"
      neighborhood: place.neighborhood,
      lat: place.lat,
      lng: place.lng,
      phone: place.phone,
      website: place.website,
      instagram: place.instagram,
      openingHours: hours ?? undefined,
      hoursSource: hours ? "source" : null,
      hoursUpdatedAt: hours ? now : null,
      trust: source.trust === "OFFICIAL" ? "OFFICIAL" : "IMPORTED",
      primarySourceId: source.id,
      sourceUrl: place.sourceUrl,
      importedAt: now,
      lastSyncedAt: now,
      lastVerifiedAt: now,
      nextSyncAt,
      searchText: buildSearchText(place.name, place.address, place.neighborhood, cityName),
    },
    select: { id: true, slug: true, name: true, address: true, lat: true, lng: true, type: true },
  });
}

async function flagRecord(key: { sourceId_externalId: { sourceId: string; externalId: string } }, reason: string) {
  const r = await db.sourceVenueRecord.findUnique({ where: key, select: { reviewReasons: true } });
  if (r && !r.reviewReasons.includes(reason)) await db.sourceVenueRecord.update({ where: key, data: { reviewReasons: [...r.reviewReasons, reason] } });
}

// ─── Restricted providers (Google): link IDs only ───────────────────────────

async function linkRestrictedPlace(
  place: ProviderPlace,
  source: Source,
  policy: PlacePolicy,
  venues: VenueCandidate[],
  opts: { providerLabel: string },
): Promise<"updated" | "unchanged" | "queued" | "skipped" | "duplicates"> {
  const now = new Date();
  const key = { sourceId_externalId: { sourceId: source.id, externalId: place.providerId } };
  // Only coordinates may be cached, and only for a limited time.
  const expiresAt = policy.coordinatesTtlDays != null ? new Date(now.getTime() + policy.coordinatesTtlDays * 86400_000) : null;
  const recordData = { data: { lat: place.lat, lng: place.lng } as Prisma.InputJsonValue, contentHash: place.providerId, lastSeenAt: now, missedSyncs: 0, expiresAt };

  const byId = await db.venue.findUnique({ where: { googlePlaceId: place.providerId }, select: venueSelect });
  // The name is compared in memory and discarded (never stored).
  const matched = byId ?? (() => {
    const m = matchVenue(venues, place.name, place.lat, place.lng);
    return m ? db.venue.findUnique({ where: { id: m.id }, select: venueSelect }) : null;
  })();
  const venue = await matched;

  if (!venue) {
    if (place.businessStatus === "CLOSED_PERMANENTLY") return "skipped";
    const reasons = [`Lugar de ${opts.providerLabel} sin equivalente en ORIVEXY NIGHTS: verifica y crea el local desde una fuente con permiso de uso`];
    await db.sourceVenueRecord.upsert({ where: key, create: { ...key.sourceId_externalId, ...recordData, reviewStatus: "PENDING", reviewReasons: reasons }, update: recordData });
    return "queued";
  }

  const data: Prisma.VenueUpdateInput = { lastVerifiedAt: now };
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  if (!venue.googlePlaceId) {
    const taken = await db.venue.findUnique({ where: { googlePlaceId: place.providerId }, select: { id: true } });
    if (!taken) {
      data.googlePlaceId = place.providerId;
      changes.push({ field: "googlePlaceId", oldValue: null, newValue: place.providerId });
    }
  }
  if (place.businessStatus === "CLOSED_PERMANENTLY" && venue.isActive) {
    if (venue.trust === "IMPORTED") {
      Object.assign(data, { isActive: false, closedAt: now, inactiveReason: `Cerrado según ${opts.providerLabel}` });
      changes.push({ field: "isActive", oldValue: "true", newValue: "false" });
    } else await flagRecord(key, `${opts.providerLabel} indica cierre definitivo: revisar`);
  }
  await db.$transaction([
    db.venue.update({ where: { id: venue.id }, data }),
    db.venueChange.createMany({ data: changes.map((ch) => ({ ...ch, venueId: venue.id, sourceId: source.id })) }),
    db.sourceVenueRecord.upsert({ where: key, create: { ...key.sourceId_externalId, ...recordData, venueId: venue.id, reviewStatus: "AUTO", reviewReasons: [] }, update: { ...recordData, venueId: venue.id } }),
  ]);
  return changes.length ? "updated" : byId ? "unchanged" : "duplicates";
}

// ─── Closures ────────────────────────────────────────────────────────────────

/** Venues this source created and stopped listing (twice in a row) are closed. */
async function closeMissing(source: Source, runStart: Date, providerLabel: string): Promise<number> {
  await db.sourceVenueRecord.updateMany({ where: { sourceId: source.id, lastSeenAt: { lt: runStart } }, data: { missedSyncs: { increment: 1 } } });
  const gone = await db.sourceVenueRecord.findMany({
    where: {
      sourceId: source.id,
      missedSyncs: { gte: MISSED_SYNCS_TO_CLOSE },
      venue: { primarySourceId: source.id, trust: "IMPORTED", isActive: true },
    },
    select: { venueId: true },
  });
  const now = new Date();
  for (const g of gone) {
    await db.$transaction([
      db.venue.update({ where: { id: g.venueId! }, data: { isActive: false, closedAt: now, inactiveReason: `Ya no aparece en ${providerLabel}` } }),
      db.venueChange.create({ data: { venueId: g.venueId!, sourceId: source.id, field: "isActive", oldValue: "true", newValue: "false" } }),
    ]);
  }
  return gone.length;
}

// ─── Hours refresh (VENUE_HOURS_SYNC) ────────────────────────────────────────

/** Re-reads hours of the venues linked to a source (storable providers with `refresh`). */
export async function refreshHours(source: Source, provider: PlaceProvider, c: PlaceCounters, log: (l: string) => void) {
  if (!provider.refresh || !provider.policy.storeContent) {
    log(`${provider.label}: sus condiciones no permiten guardar horarios; se omite`);
    return;
  }
  const records = await db.sourceVenueRecord.findMany({
    where: { sourceId: source.id, venueId: { not: null } },
    select: { externalId: true, venueId: true },
    take: 3000,
  });
  if (!records.length) return;
  const places = await provider.refresh(records.map((r) => r.externalId), log);
  c.found = places.length;
  const byId = new Map(places.map((p) => [p.providerId, p]));
  const now = new Date();
  for (const r of records) {
    const place = byId.get(r.externalId);
    if (!place) continue;
    try {
      const venue = await db.venue.findUniqueOrThrow({ where: { id: r.venueId! }, select: venueSelect });
      const overwrite = mayOverwrite({ sourceId: source.id, sourceTrust: source.trust, sourceVenueId: source.venueId, venue });
      const hours = sanitizeHours(place.hours);
      const changed = hours && str(hours) !== str(venue.openingHours) && (overwrite || !venue.openingHours);
      if (place.businessStatus === "CLOSED_PERMANENTLY" && venue.isActive && overwrite && venue.trust === "IMPORTED") {
        await db.$transaction([
          db.venue.update({ where: { id: venue.id }, data: { isActive: false, closedAt: now, inactiveReason: `Cerrado según ${provider.label}` } }),
          db.venueChange.create({ data: { venueId: venue.id, sourceId: source.id, field: "isActive", oldValue: "true", newValue: "false" } }),
        ]);
        c.deactivated++;
        continue;
      }
      if (!changed) {
        await db.venue.update({ where: { id: venue.id }, data: { lastVerifiedAt: now } });
        c.unchanged++;
        continue;
      }
      const fieldUpdatedAt = { ...((venue.fieldUpdatedAt as Record<string, string> | null) ?? {}), openingHours: now.toISOString() };
      await db.$transaction([
        db.venue.update({ where: { id: venue.id }, data: { openingHours: hours!, hoursUpdatedAt: now, hoursSource: "source", fieldUpdatedAt, lastVerifiedAt: now, lastSyncedAt: now } }),
        db.venueChange.create({ data: { venueId: venue.id, sourceId: source.id, field: "openingHours", oldValue: str(venue.openingHours), newValue: str(hours) } }),
      ]);
      c.updated++;
    } catch (err) {
      c.errors++;
      log(`${r.externalId}: ${(err as Error).message}`);
    }
  }
}

// ─── Event → Venue ───────────────────────────────────────────────────────────

/**
 * Links upcoming imported events without venue to a venue of the city when
 * place name + location match (e.g. after new venues were discovered).
 */
export async function linkEventsToVenues(cityId: string): Promise<number> {
  const venues = await loadCityVenues(cityId);
  if (!venues.length) return 0;
  const events = await db.event.findMany({
    where: { cityId, venueId: null, source: "IMPORT", status: "PUBLISHED", startsAt: { gt: new Date(Date.now() - 6 * 3600_000) } },
    select: { id: true, locationName: true, lat: true, lng: true, primarySourceId: true },
    take: 1000,
  });
  let linked = 0;
  for (const e of events) {
    const v = matchVenue(venues, e.locationName, e.lat, e.lng);
    if (!v) continue;
    await db.$transaction([
      db.event.update({ where: { id: e.id }, data: { venueId: v.id } }),
      db.eventChange.create({ data: { eventId: e.id, sourceId: e.primarySourceId, field: "venueId", oldValue: null, newValue: v.id } }),
    ]);
    linked++;
  }
  return linked;
}

