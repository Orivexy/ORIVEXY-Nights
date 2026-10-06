/**
 * ORIVEXY NIGHTS covers Barcelona. Adding a city = add it here and run the
 * seed (or insert a City row). Everything else is scoped by cityId.
 */
export const COUNTRIES = [{ code: "ES", name: "España", currency: "EUR" }] as const;

export const CITIES = [
  { slug: "barcelona", name: "Barcelona", countryCode: "ES", lat: 41.3874, lng: 2.1686, timezone: "Europe/Madrid" },
] as const;
