import { route } from "@/server/http";
import { getMapPlaces } from "@/server/services/map";
import { getCurrentCity } from "@/server/services/cities";

export const GET = route({ rateLimit: "read" }, async () => {
  const city = await getCurrentCity();
  return { city, places: await getMapPlaces(city, { scope: "all" }) };
});
