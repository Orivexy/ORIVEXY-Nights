import "server-only";
import { env } from "../../env";
import { fetchJson } from "../../discovery/fetcher";
import { QuotaExceededError, withQuota } from "../usage";
import type { PlaceProvider } from "../types";
import { buildDiscoveryQuery, buildRefreshQuery, parseOverpass, type OverpassElement } from "./osm-parse";

/**
 * OpenStreetMap via the Overpass API. No key needed; ODbL lets us store the
 * data and show it on any map with attribution. The public instance asks for
 * fair use (roughly < 10 000 requests and < 1 GB per day): ORIVEXY NIGHTS makes a
 * handful of requests per day, capped by OVERPASS_DAILY_LIMIT.
 */
type OverpassResponse = { elements?: OverpassElement[]; remark?: string };

/**
 * The main Overpass instance is often saturated (HTTP 429/504 "server too
 * busy"): the query is retried on the next public mirror, in order.
 */
export function overpassEndpoints(): string[] {
  const list = [env.OVERPASS_API_URL, ...env.OVERPASS_MIRRORS.split(",").map((u) => u.trim())].filter(Boolean);
  return [...new Set(list)];
}

async function overpass(query: string) {
  const errors: string[] = [];
  for (const endpoint of overpassEndpoints()) {
    try {
      const json = await withQuota("overpass", () =>
        fetchJson<OverpassResponse>(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(),
          timeoutMs: 190_000, // the query itself may run up to 180 s on a busy server
          maxBytes: 25 * 1024 * 1024,
        }),
      );
      // Overpass reports timeouts/partial results in `remark`: never treat that as a complete list.
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(`Overpass: ${json.remark.slice(0, 200)}`);
      return json;
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      errors.push(`${new URL(endpoint).host}: ${(err as Error).message}`);
    }
  }
  throw new Error(`Ningún servidor de OpenStreetMap respondió (${errors.join(" · ")})`);
}

export const osmProvider: PlaceProvider = {
  key: "osm",
  label: "OpenStreetMap (Overpass API)",
  policy: {
    storeContent: true,
    coordinatesTtlDays: null,
    displayOnAnyMap: true,
    attribution: "© OpenStreetMap contributors",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  configured: () => true,
  async discover(area, { categories, log }) {
    const json = await overpass(buildDiscoveryQuery(area, categories));
    const places = parseOverpass(json);
    log(`OpenStreetMap: ${json.elements?.length ?? 0} elementos, ${places.length} locales válidos`);
    return places;
  },
  async refresh(ids, log) {
    const out = [];
    for (let i = 0; i < ids.length; i += 300) {
      const query = buildRefreshQuery(ids.slice(i, i + 300));
      if (!query) continue;
      const json = await overpass(query);
      out.push(...parseOverpass(json));
    }
    log(`OpenStreetMap: ${out.length}/${ids.length} locales releídos`);
    return out;
  },
};
