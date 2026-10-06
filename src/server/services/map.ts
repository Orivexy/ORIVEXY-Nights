import "server-only";
import { db } from "../db";
import { env } from "../env";
import type { MapEvent, MapPlace } from "@/lib/types";
import { notEndedWhere } from "./events";
import { sanitizeHours } from "@/lib/hours";
import type { CityData } from "./cities";

/**
 * Map configuration. `renderer` picks the MapProvider component (Leaflet
 * today; a Mapbox GL / Google Maps renderer can be added in
 * src/components/map/providers). `provider` picks the tiles: keyless
 * providers load directly; keyed ones go through /api/map/tiles so tokens
 * never reach the browser.
 */
export interface MapConfig {
  /** Rendering engine (MapProvider implementation) — see src/components/map/providers. */
  renderer: "leaflet" | "maplibre";
  provider: "openfreemap" | "carto" | "mapbox" | "maptiler";
  /** Raster tiles (Leaflet, and the fallback when WebGL is not available). */
  tileUrl: string;
  /** Vector style (MapLibre). */
  styleUrl?: string;
  /** Aerial imagery tiles for the satellite view (XYZ) and their attribution. */
  satelliteUrl?: string;
  satelliteAttribution?: string;
  attribution: string;
  maxZoom: number;
}

const CARTO_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';

const SATELLITE = env.MAP_SATELLITE_URL
  ? { satelliteUrl: env.MAP_SATELLITE_URL, satelliteAttribution: env.MAP_SATELLITE_ATTRIBUTION }
  : {};

export function getMapConfig(): MapConfig {
  return { ...baseConfig(), ...SATELLITE };
}

function baseConfig(): MapConfig {
  switch (env.MAP_PROVIDER) {
    case "mapbox":
      return {
        renderer: "leaflet",
        provider: "mapbox",
        tileUrl: "/api/map/tiles/{z}/{x}/{y}",
        attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © OpenStreetMap',
        maxZoom: 19,
      };
    case "maptiler":
      return {
        renderer: "leaflet",
        provider: "maptiler",
        tileUrl: "/api/map/tiles/{z}/{x}/{y}",
        attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © OpenStreetMap',
        maxZoom: 19,
      };
    case "carto":
      return {
        renderer: "leaflet",
        provider: "carto",
        tileUrl: CARTO_DARK,
        attribution: CARTO_ATTRIBUTION,
        maxZoom: 19,
      };
    default:
      // Vector map (MapLibre + OpenFreeMap: no key, no request limits), raster CARTO as fallback.
      return {
        renderer: "maplibre",
        provider: "openfreemap",
        styleUrl: env.MAP_STYLE_URL,
        tileUrl: CARTO_DARK,
        attribution: CARTO_ATTRIBUTION,
        maxZoom: 20,
      };
  }
}

/** Upstream URL for keyed providers (server-side only). */
export function upstreamTileUrl(z: number, x: number, y: number): string | null {
  if (env.MAP_PROVIDER === "mapbox" && env.MAPBOX_TOKEN) {
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${env.MAPBOX_TOKEN}`;
  }
  if (env.MAP_PROVIDER === "maptiler" && env.MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/dataviz-dark/256/${z}/${x}/${y}@2x.png?key=${env.MAPTILER_KEY}`;
  }
  return null;
}

const MAP_HORIZON_DAYS = 60;

const mapEventSelect = {
  id: true, slug: true, title: true, startsAt: true, timeUnknown: true, endsAt: true, priceMin: true, priceMax: true, coverKey: true, ticketUrl: true, officialUrl: true,
  category: { select: { slug: true } },
  genres: { select: { genre: { select: { slug: true } } } },
} as const;

type MapEventRow = { id: string; slug: string; title: string; startsAt: Date; timeUnknown: boolean; endsAt: Date | null; priceMin: number | null; priceMax: number | null; coverKey: string | null; ticketUrl: string | null; officialUrl: string | null; category: { slug: string }; genres: Array<{ genre: { slug: string } }> };

const toMapEvent = (e: MapEventRow): MapEvent => ({
  id: e.id, slug: e.slug, title: e.title, startsAt: e.startsAt, timeUnknown: e.timeUnknown, endsAt: e.endsAt, priceMin: e.priceMin, priceMax: e.priceMax,
  coverKey: e.coverKey, ticketUrl: e.ticketUrl, officialUrl: e.officialUrl, category: e.category.slug, genres: e.genres.map((g) => g.genre.slug),
});

/** Attribution required by a source's licence (OpenStreetMap: ODbL). */
function attributionFor(type: string | undefined): string | null {
  return type === "OSM_OVERPASS" ? "© OpenStreetMap contributors" : null;
}

/**
 * What the map shows for a city, from the database only (no external calls on
 * page views). "clubs": discotecas and clubs, no event pins (home). "all":
 * every active place with its upcoming events plus standalone events, for the
 * next 60 days (map page, filtered on the client).
 */
export async function getMapPlaces(city: CityData, opts: { scope?: "clubs" | "all"; now?: Date } = {}): Promise<MapPlace[]> {
  const all = opts.scope === "all";
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + MAP_HORIZON_DAYS * 24 * 3600_000);
  const upcoming = { status: "PUBLISHED" as const, startsAt: { lt: horizon }, ...notEndedWhere(now) };
  const [venues, events] = await Promise.all([
    db.venue.findMany({
      where: { cityId: city.id, isActive: true, ...(all ? {} : { type: { in: ["CLUB", "DISCO"] } }) },
      select: {
        id: true, slug: true, name: true, lat: true, lng: true, coverKey: true, address: true, neighborhood: true, type: true,
        ratingAvg: true, ratingCount: true, priceMin: true, priceMax: true, openingHours: true, isFeatured: true,
        genres: { select: { genre: { select: { slug: true } } } },
        primarySource: { select: { type: true } },
        // Home map: places only (take 0).
        events: { where: upcoming, orderBy: { startsAt: "asc" }, take: all ? 8 : 0, select: mapEventSelect },
      },
    }),
    all
      ? db.event.findMany({
          where: { cityId: city.id, venueId: null, ...upcoming },
          orderBy: { startsAt: "asc" },
          take: 400,
          select: { ...mapEventSelect, lat: true, lng: true, locationName: true, address: true },
        })
      : Promise.resolve([]),
  ]);
  return [
    ...venues.map<MapPlace>((v) => ({
      kind: "venue", id: v.id, slug: v.slug, name: v.name, lat: v.lat, lng: v.lng, coverKey: v.coverKey, address: v.address,
      neighborhood: v.neighborhood, venueType: v.type, featured: v.isFeatured, genres: v.genres.map((g) => g.genre.slug),
      ratingAvg: v.ratingCount > 0 ? v.ratingAvg : null, ratingCount: v.ratingCount > 0 ? v.ratingCount : null,
      priceMin: v.priceMin, priceMax: v.priceMax, currency: city.currency, timezone: city.timezone,
      openingHours: sanitizeHours(v.openingHours),
      events: v.events.map(toMapEvent),
      attribution: attributionFor(v.primarySource?.type),
    })),
    ...events.map<MapPlace>((e) => ({
      kind: "event", id: e.id, slug: e.slug, name: e.title, lat: e.lat, lng: e.lng, coverKey: e.coverKey,
      address: e.address ?? e.locationName, neighborhood: null, venueType: null, featured: false, genres: e.genres.map((g) => g.genre.slug),
      ratingAvg: null, ratingCount: null, priceMin: e.priceMin, priceMax: e.priceMax, currency: city.currency, timezone: city.timezone,
      openingHours: null, events: [toMapEvent(e)], attribution: null,
    })),
  ];
}
