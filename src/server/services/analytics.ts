import "server-only";
import type { InteractionType } from "@prisma/client";
import { db } from "../db";

export interface InteractionInput {
  type: InteractionType;
  userId?: string | null;
  eventId?: string | null;
  venueId?: string | null;
  artistId?: string | null;
  query?: string | null;
}

/** Same signed-in user, same thing, within this window: counted once (page reloads). */
const REPEAT_WINDOW_MS = 30 * 60_000;

/**
 * Records a product metric. Never throws and never blocks the caller: a lost
 * metric must not break a page. Stores no IP, user agent or location.
 */
export function recordInteraction(input: InteractionInput): void {
  void (async () => {
    const data = {
      type: input.type,
      userId: input.userId ?? null,
      eventId: input.eventId ?? null,
      venueId: input.venueId ?? null,
      artistId: input.artistId ?? null,
      query: input.query ? input.query.trim().toLowerCase().slice(0, 80) || null : null,
    };
    if (data.userId) {
      const recent = await db.interaction.findFirst({
        where: { ...data, createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) return;
    }
    await db.interaction.create({ data });
  })().catch((err) => console.warn("[analytics]", (err as Error).message));
}

/** Admin dashboard: totals by kind over the last days, and the most viewed events. */
export async function interactionStats(days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const [byType, topEvents, topSearches] = await Promise.all([
    db.interaction.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.interaction.groupBy({ by: ["eventId"], where: { type: "EVENT_VIEW", createdAt: { gte: since }, eventId: { not: null } }, _count: { _all: true }, orderBy: { _count: { eventId: "desc" } }, take: 8 }),
    db.interaction.groupBy({ by: ["query"], where: { type: "SEARCH", createdAt: { gte: since }, query: { not: null } }, _count: { _all: true }, orderBy: { _count: { query: "desc" } }, take: 10 }),
  ]);
  const events = await db.event.findMany({ where: { id: { in: topEvents.map((t) => t.eventId!) } }, select: { id: true, slug: true, title: true } });
  const title = new Map(events.map((e) => [e.id, e]));
  return {
    days,
    totals: Object.fromEntries(byType.map((t) => [t.type, t._count._all])) as Partial<Record<InteractionType, number>>,
    topEvents: topEvents.flatMap((t) => (title.get(t.eventId!) ? [{ ...title.get(t.eventId!)!, views: t._count._all }] : [])),
    topSearches: topSearches.map((t) => ({ query: t.query!, count: t._count._all })),
  };
}
