import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { notEndedWhere } from "@/server/services/events";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/** Public, indexable pages: sections, active venues, upcoming events and artists with dates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.APP_URL.replace(/\/$/, "");
  const now = new Date();
  const [venues, events, artists] = await Promise.all([
    db.venue.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true }, take: 5000 }),
    db.event.findMany({ where: { status: "PUBLISHED", ...notEndedWhere(now) }, select: { slug: true, updatedAt: true }, orderBy: { startsAt: "asc" }, take: 20000 }),
    db.artist.findMany({ where: { events: { some: { event: { status: "PUBLISHED", ...notEndedWhere(now) } } } }, select: { slug: true, updatedAt: true }, take: 5000 }),
  ]);
  return [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/events`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/map`, changeFrequency: "daily", priority: 0.7 },
    ...events.map((e) => ({ url: `${base}/events/${e.slug}`, lastModified: e.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })),
    ...venues.map((v) => ({ url: `${base}/venues/${v.slug}`, lastModified: v.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...artists.map((a) => ({ url: `${base}/artists/${a.slug}`, lastModified: a.updatedAt, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
