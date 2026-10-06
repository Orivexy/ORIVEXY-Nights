import type { EventDetail, VenueDetail } from "./types";
import { imageUrl } from "./media";

/** JSON for a <script type="application/ld+json">, safe to inline (no "</script>" breakouts). */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const abs = (base: string, path: string | null) => (path ? new URL(path, base).toString() : undefined);
const euros = (cents: number | null) => (cents == null ? undefined : (cents / 100).toFixed(2));

/** schema.org Event for an event page (search engines' event results). */
export function eventJsonLd(e: EventDetail, base: string) {
  const place = {
    "@type": "Place",
    name: e.venue?.name ?? e.locationName,
    address: e.address ?? e.locationName,
    geo: { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lng },
  };
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    description: e.description ?? undefined,
    startDate: e.timeUnknown ? e.startsAt.toISOString().slice(0, 10) : e.startsAt.toISOString(),
    endDate: e.endsAt?.toISOString(),
    eventStatus: e.status === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: place,
    image: abs(base, imageUrl(e.coverKey, "lg")),
    url: abs(base, `/events/${e.slug}`),
    isAccessibleForFree: e.priceMin === 0 || undefined,
    typicalAgeRange: e.minAge ? `${e.minAge}-` : undefined,
    performer: e.artists.length ? e.artists.map((a) => ({ "@type": "PerformingGroup", name: a.name })) : undefined,
    organizer: e.organizer ? { "@type": "Person", name: e.organizer.displayName } : e.organizerName ? { "@type": "Organization", name: e.organizerName } : undefined,
    offers:
      e.priceMin != null
        ? {
            "@type": "Offer",
            price: euros(e.priceMin),
            priceCurrency: e.currency,
            url: e.ticketUrl ?? e.officialUrl ?? abs(base, `/events/${e.slug}`),
            availability: "https://schema.org/InStock",
          }
        : undefined,
  };
}

const VENUE_SCHEMA_TYPE: Record<string, string> = { CLUB: "NightClub", DISCO: "NightClub", BAR: "BarOrPub", CONCERT_HALL: "MusicVenue" };

/** schema.org place for a venue page. */
export function venueJsonLd(v: Pick<VenueDetail, "name" | "slug" | "type" | "address" | "lat" | "lng" | "coverKey" | "description" | "website">, base: string) {
  return {
    "@context": "https://schema.org",
    "@type": VENUE_SCHEMA_TYPE[v.type] ?? "EventVenue",
    name: v.name,
    description: v.description ?? undefined,
    address: v.address,
    geo: { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng },
    image: abs(base, imageUrl(v.coverKey, "lg")),
    url: abs(base, `/venues/${v.slug}`),
    sameAs: v.website ? [v.website] : undefined,
  };
}
