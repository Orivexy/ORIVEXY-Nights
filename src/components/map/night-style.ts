/**
 * Turns a public OpenMapTiles vector style (OpenFreeMap "liberty": no key,
 * no limits, © OpenStreetMap) into ORIVEXY NIGHTS's night look, close to the
 * dark mode of Apple Maps: charcoal land, deep-blue water, soft grey roads,
 * 3D buildings and no third-party POI icons (our own markers stand out).
 * Pure function: works on any OpenMapTiles-schema style.
 */
type Layer = {
  id: string;
  type: string;
  "source-layer"?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  minzoom?: number;
};
export type StyleJson = { version: number; sources: Record<string, unknown>; layers: Layer[]; [k: string]: unknown };

export const NIGHT = {
  land: "#1c1c1f",
  landuse: "#202024",
  park: "#1b2620",
  water: "#132033",
  building: "#29292e",
  building3d: "#2e2e34",
  road: "#35353c",
  roadMajor: "#43434c",
  motorway: "#565662",
  casing: "#232327",
  rail: "#303036",
  boundary: "#4a4a57",
  label: "#c9c9d1",
  labelMinor: "#8e8e98",
  labelWater: "#5f7fa6",
  halo: "#1c1c1f",
} as const;

const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

function roadColor(id: string) {
  if (has(id, "casing", "outline")) return NIGHT.casing;
  if (has(id, "motorway", "trunk")) return NIGHT.motorway;
  if (has(id, "primary", "secondary")) return NIGHT.roadMajor;
  if (has(id, "rail", "transit")) return NIGHT.rail;
  return NIGHT.road;
}

export function nightStyle(input: StyleJson): StyleJson {
  const layers: Layer[] = [];
  for (const src of input.layers) {
    const l: Layer = { ...src, paint: { ...src.paint }, layout: { ...src.layout } };
    const sl = l["source-layer"] ?? "";
    const id = l.id.toLowerCase();
    const paint = l.paint!;

    // Third-party points of interest and their icons compete with our markers.
    if (sl === "poi" || sl === "aerodrome_label" || has(id, "poi")) continue;

    switch (l.type) {
      case "background":
        paint["background-color"] = NIGHT.land;
        break;
      case "fill":
        delete paint["fill-pattern"];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        if (sl === "water" || has(id, "water", "ocean")) paint["fill-color"] = NIGHT.water;
        else if (sl === "building") paint["fill-color"] = NIGHT.building;
        else if (sl === "park" || has(id, "park", "grass", "wood", "forest", "garden", "cemetery", "pitch", "scrub", "wetland")) paint["fill-color"] = NIGHT.park;
        else paint["fill-color"] = NIGHT.landuse;
        break;
      case "fill-extrusion":
        paint["fill-extrusion-color"] = NIGHT.building3d;
        paint["fill-extrusion-opacity"] = 0.85;
        break;
      case "line":
        delete paint["line-pattern"];
        if (sl === "waterway" || has(id, "water")) paint["line-color"] = NIGHT.water;
        else if (sl === "boundary" || has(id, "boundary", "admin")) paint["line-color"] = NIGHT.boundary;
        else paint["line-color"] = roadColor(id);
        break;
      case "symbol": {
        const water = sl === "water_name" || has(id, "water");
        const major = sl === "place";
        paint["text-color"] = water ? NIGHT.labelWater : major ? NIGHT.label : NIGHT.labelMinor;
        paint["text-halo-color"] = NIGHT.halo;
        paint["text-halo-width"] = 1.2;
        paint["icon-opacity"] = 0.55;
        break;
      }
    }
    layers.push(l);
  }
  return { ...input, layers };
}

/** Adds an aerial imagery layer (hidden until the satellite view is turned on). */
export function withSatellite(style: StyleJson, tileUrl: string, attribution: string): StyleJson {
  const layers = [...style.layers];
  const at = layers.findIndex((l) => l.type !== "background");
  layers.splice(at < 0 ? layers.length : at, 0, { id: "nx-satellite", type: "raster", layout: { visibility: "none" }, paint: { "raster-fade-duration": 150 } } as Layer & { source?: string });
  (layers[at < 0 ? layers.length - 1 : at] as Layer & { source?: string }).source = "nx-satellite";
  return {
    ...style,
    sources: { ...style.sources, "nx-satellite": { type: "raster", tiles: [tileUrl], tileSize: 256, maxzoom: 19, attribution } },
    layers,
  };
}

/**
 * Layer visibility for the satellite (hybrid) view: imagery plus labels,
 * like Apple Maps; everything else back to how the style defined it.
 */
export function satelliteVisibility(style: StyleJson, on: boolean): Array<[string, "visible" | "none"]> {
  return style.layers.map((l) => {
    const original = (l.layout?.visibility as "visible" | "none" | undefined) ?? "visible";
    if (l.id === "nx-satellite") return [l.id, on ? "visible" : "none"];
    if (!on) return [l.id, original];
    return [l.id, l.type === "symbol" ? original : "none"];
  });
}
