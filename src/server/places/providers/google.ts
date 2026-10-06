import "server-only";
import { env } from "../../env";
import { fetchJson } from "../../discovery/fetcher";
import { withQuota } from "../usage";
import type { BusinessStatus, NightlifeCategory, PlaceProvider, ProviderPlace } from "../types";

/**
 * Google Places API (New) — Text Search. Official API, never scraping.
 *
 * Google Maps Platform terms (Places): only the place ID may be stored
 * indefinitely; latitude/longitude may be cached for up to 30 days; other
 * content (name, address, hours, rating, photos…) may not be stored, and
 * Places content may not be shown on a non-Google map. ORIVEXY NIGHTS's map is not a
 * Google map, so this provider is used only to *link* places: it adds the
 * place ID to venues we already know and flags permanent closures. Its
 * policy below makes the sync enforce that.
 *
 * Billing: the field mask (id, location, displayName, businessStatus) is
 * billed as Text Search Pro; rating/opening hours would be Enterprise and
 * are deliberately not requested.
 */
const QUERIES: Record<NightlifeCategory, { textQuery: string; includedType?: string }> = {
  nightclub: { textQuery: "discoteca", includedType: "night_club" },
  dance_club: { textQuery: "club de baile" },
  music_venue: { textQuery: "sala de conciertos" },
  live_music_venue: { textQuery: "música en directo" },
  event_venue: { textQuery: "sala de eventos", includedType: "event_venue" },
  music_bar: { textQuery: "bar musical", includedType: "bar" },
};

interface GPlace {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  businessStatus?: BusinessStatus;
}

export const googleProvider: PlaceProvider = {
  key: "google",
  label: "Google Places API (New)",
  policy: {
    storeContent: false,
    coordinatesTtlDays: 30,
    displayOnAnyMap: false,
    attribution: "Google Maps",
    licenseUrl: "https://cloud.google.com/maps-platform/terms",
  },
  configured: () => Boolean(env.GOOGLE_PLACES_API_KEY),
  async discover(area, { categories, maxPages = 1, log }) {
    if (!env.GOOGLE_PLACES_API_KEY) throw new Error("Falta GOOGLE_PLACES_API_KEY");
    const out = new Map<string, ProviderPlace>();
    for (const category of categories) {
      const q = QUERIES[category];
      let pageToken: string | undefined;
      for (let page = 0; page < Math.min(maxPages, 3); page++) {
        const data = await withQuota("google_places", () =>
          fetchJson<{ places?: GPlace[]; nextPageToken?: string }>("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
              "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.businessStatus,nextPageToken",
            },
            body: JSON.stringify({
              textQuery: `${q.textQuery} ${area.name}`,
              ...(q.includedType ? { includedType: q.includedType, strictTypeFiltering: true } : {}),
              pageSize: 20,
              pageToken,
              languageCode: "es",
              locationBias: { circle: { center: { latitude: area.lat, longitude: area.lng }, radius: Math.min(50_000, area.radiusKm * 1000) } },
            }),
          }),
        );
        for (const p of data.places ?? []) {
          const prev = out.get(p.id);
          if (prev) {
            if (!prev.categories.includes(category)) prev.categories.push(category);
            continue;
          }
          out.set(p.id, {
            providerId: p.id,
            name: p.displayName?.text ?? null, // used in memory for matching only
            address: null,
            neighborhood: null,
            lat: p.location?.latitude ?? null,
            lng: p.location?.longitude ?? null,
            phone: null,
            website: null,
            instagram: null,
            categories: [category],
            hours: null,
            businessStatus: p.businessStatus ?? null,
            rating: null,
            ratingCount: null,
            sourceUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id)}`,
          });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
    }
    log(`Google Places: ${out.size} lugares`);
    return [...out.values()];
  },
};
