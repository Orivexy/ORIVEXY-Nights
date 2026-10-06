import type { Metadata } from "next";
import { NightMap } from "@/components/map/night-map";
import { getCurrentCity } from "@/server/services/cities";
import { getMapConfig, getMapPlaces } from "@/server/services/map";
import type { WhenFilter } from "@/lib/map-filters";

export const metadata: Metadata = { title: "Mapa" };

const WHEN = new Set<WhenFilter>(["all", "today", "tomorrow", "weekend", "week"]);

export default async function MapPage({ searchParams }: { searchParams: Promise<{ when?: string; q?: string }> }) {
  const [city, sp] = await Promise.all([getCurrentCity(), searchParams]);
  const places = await getMapPlaces(city, { scope: "all" });
  const when = WHEN.has(sp.when as WhenFilter) ? (sp.when as WhenFilter) : "all";
  return <NightMap config={getMapConfig()} places={places} center={{ lat: city.lat, lng: city.lng }} cityName={city.name} initialWhen={when} initialQuery={sp.q?.slice(0, 80) ?? ""} />;
}
