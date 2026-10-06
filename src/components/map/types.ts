import type { MapConfig } from "@/server/services/map";

/**
 * MapProvider contract. Every renderer (Leaflet today; Mapbox GL, Google
 * Maps… tomorrow) implements `MapProviderProps` and is registered in
 * map-view.tsx. The rest of ORIVEXY NIGHTS never imports a map library directly.
 */

/** Marker style: ORIVEXY NIGHTS's own markers, not the provider's default pins. */
export type MarkerVariant = "club" | "venue" | "fiesta" | "fm" | "festival" | "concierto" | "dj" | "evento" | "otro" | string;

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  variant: MarkerVariant;
  label?: string;
  /** Something is happening right now (pulsing). */
  live?: boolean;
  /** Open right now (venues). */
  open?: boolean;
}

export interface MapViewport {
  center: { lat: number; lng: number };
  zoom: number;
}

export interface MapProviderProps {
  config: MapConfig;
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Tap on empty map (used by the location picker). */
  onMapClick?: (latlng: { lat: number; lng: number }) => void;
  interactive?: boolean;
  /** Mouse-wheel zoom (off for maps embedded in a scrolling page). Defaults to `interactive`. */
  wheelZoom?: boolean;
  /** Group nearby markers into count bubbles. */
  cluster?: boolean;
  /** Aerial imagery with labels (hybrid), when the config has satellite tiles. */
  satellite?: boolean;
  /** Show +/- buttons (desktop). */
  zoomControls?: boolean;
  user?: { lat: number; lng: number } | null;
  /**
   * Frame all markers on first load (instead of `center`/`zoom`), keeping
   * clear the edges covered by overlays (px): e.g. a card on the left.
   */
  fitMarkers?: { top?: number; right?: number; bottom?: number; left?: number; maxZoom?: number };
  /** Bumping this number recenters the map on `center` even if it did not change. */
  recenterKey?: number;
  className?: string;
}

/** The map stays on Barcelona (with its edge: L'Hospitalet, Montjuïc, the Fòrum). [[west, south], [east, north]] */
export const BARCELONA_BOUNDS: [[number, number], [number, number]] = [[2.04, 41.3], [2.26, 41.48]];
export const MIN_ZOOM = 11;
