import type { OpeningHours } from "@/lib/types";

/**
 * PlaceProvider: the only thing ORIVEXY NIGHTS knows about a places API. Adding or
 * replacing a provider (Google, OSM, Foursquare, a partner…) means writing
 * one of these; the sync, deduplication and the app stay the same.
 */

/** Nightlife categories ORIVEXY NIGHTS searches for (provider-neutral). */
export const NIGHTLIFE_CATEGORIES = ["nightclub", "dance_club", "music_venue", "live_music_venue", "event_venue"] as const;
/** "music_bar" (bars and pubs with music, cocktail bars) comes from official city data, never searched by default. */
export type NightlifeCategory = (typeof NIGHTLIFE_CATEGORIES)[number] | "music_bar";
export const ALL_PLACE_CATEGORIES: readonly NightlifeCategory[] = [...NIGHTLIFE_CATEGORIES, "music_bar"];

/**
 * What the provider's terms allow us to do with its data. The sync enforces
 * it: content from a provider with `storeContent: false` is used only to
 * match places and is never written to ORIVEXY NIGHTS's tables.
 */
export interface PlacePolicy {
  /** May name, address, hours, phone… be kept in our database? */
  storeContent: boolean;
  /** Days coordinates may be kept; null = no limit. */
  coordinatesTtlDays: number | null;
  /** May the content be shown on a map from another provider? */
  displayOnAnyMap: boolean;
  /** Attribution to show next to the data. */
  attribution: string;
  licenseUrl: string;
}

export type BusinessStatus = "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";

/** A place as returned by a provider. Unknown values stay null — never guessed. */
export interface ProviderPlace {
  /** Stable id within the provider ("node/123", Google place id…). */
  providerId: string;
  name: string | null;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  categories: NightlifeCategory[];
  hours: OpeningHours | null;
  businessStatus: BusinessStatus | null;
  rating: number | null;
  ratingCount: number | null;
  sourceUrl: string | null;
}

export interface PlaceArea {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface PlaceProvider {
  key: string;
  label: string;
  policy: PlacePolicy;
  /** False when a required API key is missing. */
  configured(): boolean;
  /** Finds nightlife places in an area. */
  discover(area: PlaceArea, opts: { categories: readonly NightlifeCategory[]; maxPages?: number; log: (line: string) => void }): Promise<ProviderPlace[]>;
  /** Re-reads known places by id (cheap hours/details refresh). */
  refresh?(ids: string[], log: (line: string) => void): Promise<ProviderPlace[]>;
}
