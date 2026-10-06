import "server-only";
import { googleProvider } from "../../places/providers/google";
import type { Connector } from "../types";

/**
 * Google Places (New). Its terms only allow keeping place IDs (and
 * coordinates for 30 days), so this source links IDs to venues ORIVEXY NIGHTS already
 * knows and flags permanent closures — see src/server/places/providers/google.ts.
 * config: { categories?: NightlifeCategory[], maxPages?: number, radiusKm?: number }
 */
export const googlePlacesConnector: Connector = {
  label: "Google Places API (vincula IDs y detecta cierres)",
  placeProvider: googleProvider,
  missingConfig: () => (googleProvider.configured() ? null : "Falta la clave GOOGLE_PLACES_API_KEY"),
};
