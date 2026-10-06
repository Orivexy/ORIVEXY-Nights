/**
 * Base data. Run with `npm run db:seed` (also after `prisma migrate deploy`
 * in production). Idempotent and non-destructive: it only upserts
 * configuration — never content. ORIVEXY NIGHTS's venues and events come from the
 * configured sources (VENUE_SYNC / EVENT_SYNC) and from its users.
 *
 *  - countries, cities, categories and music genres (src/config)
 *  - business plan catalogue (inactive while monetization is off)
 *  - discovery sources per city: OpenStreetMap (no key needed), Ticketmaster
 *    and Google Places (they wait until their API key is configured)
 *  - optional first admin: ADMIN_EMAIL + ADMIN_PASSWORD (+ ADMIN_USERNAME)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES, COUNTRIES } from "../../src/config/cities";
import { CATEGORIES, GENRES } from "../../src/config/taxonomy";
import { buildSearchText } from "../../src/lib/text";

const db = new PrismaClient();
const log = (msg: string) => console.log(`  • ${msg}`);

/** Cities where discovery starts enabled: "all" (default) or a comma-separated list of slugs. */
const SEED_CITIES = (process.env.SEED_DISCOVERY_CITIES ?? "all").split(",").map((s) => s.trim()).filter(Boolean);
const discoveryEnabledFor = (slug: string) => SEED_CITIES.includes("all") || SEED_CITIES.includes(slug);

/** Xceed agenda pages of places in the verified list. */
const XCEED_PAGE_VENUES: Record<string, string> = {
  "https://xceed.me/en/barcelona/venue/sutton-barcelona": "Sutton Barcelona",
  "https://xceed.me/en/barcelona/venue/nitsa-club": "Nitsa Club",
  "https://xceed.me/en/barcelona/venue/draco-club": "Draco Disco Club",
  "https://xceed.me/es/barcelona/venue/la-biblio-bcn": "La Biblio",
  "https://xceed.me/en/barcelona/venue/laut": "LAUT",
  "https://xceed.me/en/barcelona/venue/sidecar-factory-club": "Club Sauvage",
};

async function main() {
  console.log("🌙 ORIVEXY NIGHTS · datos base");

  for (const c of COUNTRIES) await db.country.upsert({ where: { code: c.code }, create: c, update: { name: c.name, currency: c.currency } });
  const countries = new Map((await db.country.findMany()).map((c) => [c.code, c.id]));
  for (const c of CITIES) {
    const data = { name: c.name, countryId: countries.get(c.countryCode)!, lat: c.lat, lng: c.lng, timezone: c.timezone };
    await db.city.upsert({ where: { slug: c.slug }, create: { slug: c.slug, ...data }, update: data });
  }
  for (const [order, c] of CATEGORIES.entries()) await db.category.upsert({ where: { slug: c.slug }, create: { ...c, order }, update: { name: c.name, emoji: c.emoji, order } });
  for (const [order, g] of GENRES.entries()) await db.musicGenre.upsert({ where: { slug: g.slug }, create: { ...g, order }, update: { name: g.name, order } });
  log(`${CITIES.length} ciudades · ${CATEGORIES.length} categorías · ${GENRES.length} géneros`);

  const plans = [
    { code: "PLAN_FREE" as const, name: "Free", description: "Perfil y eventos básicos", features: [] },
    { code: "PLAN_PREMIUM" as const, name: "Premium", description: "Destacar eventos y perfil, estadísticas", features: ["featured_events", "featured_profile", "stats"] },
    { code: "PLAN_BUSINESS" as const, name: "Business", description: "Todo Premium + mayor visibilidad y herramientas", features: ["featured_events", "featured_profile", "stats", "priority_visibility", "organizer_tools"] },
  ];
  for (const p of plans) await db.plan.upsert({ where: { code: p.code }, create: p, update: {} });

  // Discovery sources (created once; staff manage them in /admin/discovery afterwards).
  const cities = await db.city.findMany({ where: { isActive: true }, select: { id: true, slug: true, name: true } });
  for (const city of cities) {
    await db.discoverySource.upsert({
      where: { key: `osm-${city.slug}-nightlife` },
      create: {
        key: `osm-${city.slug}-nightlife`, name: `OpenStreetMap · ocio nocturno de ${city.name}`, type: "OSM_OVERPASS", cityId: city.id, trust: "IMPORTED",
        // Barcelona uses its verified list of places instead.
        enabled: discoveryEnabledFor(city.slug) && city.slug !== "barcelona", autoPublish: true,
        config: { categories: ["nightclub", "dance_club"], radiusKm: 12 },
      },
      update: {},
    });
    if (city.slug === "barcelona") {
      // The verified list of places (src/server/discovery/curated/barcelona.ts): the only source of venues.
      await db.discoverySource.upsert({
        where: { key: "barcelona-verified-venues" },
        create: {
          id: "src_curated_bcn", key: "barcelona-verified-venues", name: "Listado verificado de Barcelona (web oficial de cada local)", type: "CURATED", cityId: city.id, trust: "VERIFIED",
          enabled: discoveryEnabledFor(city.slug), autoPublish: true, allowImages: true, syncIntervalMin: 24 * 60, config: { list: "barcelona", listedVenuesOnly: true },
        },
        update: {},
      });
      // Events of the listed places from Xceed's public agenda (schema.org data it publishes for search engines; robots.txt allows it).
      await db.discoverySource.upsert({
        where: { key: "xceed-barcelona-clubs" },
        create: {
          id: "src_xceed_bcn_clubs", key: "xceed-barcelona-clubs", name: "Xceed · agenda de los locales verificados", type: "JSON_LD_PAGE", cityId: city.id, trust: "IMPORTED",
          enabled: discoveryEnabledFor(city.slug), autoPublish: true, allowImages: true, syncIntervalMin: 12 * 60,
          url: "https://xceed.me/es/barcelona/events",
          config: {
            pages: Object.keys(XCEED_PAGE_VENUES),
            pageVenues: XCEED_PAGE_VENUES,
            followLinks: { pattern: "^https://xceed\\.me/(es|en)/barcelona/event/[^/]+/\\d+$", max: 30 },
            listedVenuesOnly: true,
          },
        },
        update: {},
      });
      // Official open data, no key: city council venues (weekly) and the Generalitat agenda (daily).
      await db.discoverySource.upsert({
        where: { key: "bcn-open-data-music-venues" },
        create: {
          key: "bcn-open-data-music-venues", name: "Ayuntamiento de Barcelona · espacios de música y copas", type: "BCN_MUSIC_VENUES", cityId: city.id, trust: "IMPORTED",
          // Replaced by the verified list. Kept for admins.
          enabled: false, autoPublish: true, syncIntervalMin: 24 * 60, config: { authoritative: true },
        },
        update: {},
      });
      await db.discoverySource.upsert({
        where: { key: "catalonia-agenda-bcn" },
        create: {
          key: "catalonia-agenda-bcn", name: "Agenda cultural de Catalunya · conciertos, festivales y fiestas de Barcelona", type: "CATALONIA_AGENDA", cityId: city.id, trust: "IMPORTED",
          // Cultural agenda (concerts, opera, festivals…): off, the app shows only discotecas. Kept for admins.
          enabled: false, autoPublish: true, allowImages: true, syncIntervalMin: 6 * 60, config: { nightlifeOnly: true },
        },
        update: {},
      });
    }
    // Key-based sources: enabled, but they wait quietly until their API key is configured.
    const short = city.slug === "barcelona" ? "bcn" : city.slug;
    await db.discoverySource.upsert({
      where: { key: `ticketmaster-${short}-music` },
      create: {
        key: `ticketmaster-${short}-music`, name: `Ticketmaster · música en ${city.name}`, type: "TICKETMASTER", cityId: city.id, trust: "IMPORTED",
        enabled: discoveryEnabledFor(city.slug), autoPublish: true, config: { classificationName: "music", maxPages: 3, ...(city.slug === "barcelona" ? { listedVenuesOnly: true } : { nightlifeOnly: true }) },
      },
      update: {},
    });
    await db.discoverySource.upsert({
      where: { key: `google-places-${short}-clubs` },
      create: {
        key: `google-places-${short}-clubs`, name: `Google Places · vincular locales de ${city.name}`, type: "GOOGLE_PLACES", cityId: city.id, trust: "IMPORTED",
        enabled: discoveryEnabledFor(city.slug) && city.slug !== "barcelona", syncIntervalMin: 7 * 24 * 60, config: { categories: ["nightclub"], maxPages: 1 },
      },
      update: {},
    });
  }
  log(`${await db.discoverySource.count()} fuentes de descubrimiento`);

  // First administrator (optional).
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres");
    const username = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN", status: "ACTIVE" } });
      log(`${email} es administrador`);
    } else {
      await db.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(password, 12),
          role: "ADMIN",
          profile: { create: { username, displayName: "Admin", searchText: buildSearchText(username, "Admin"), cityId: cities.find((c) => c.slug === "barcelona")?.id } },
        },
      });
      log(`Administrador creado: ${email} (@${username})`);
    }
  } else {
    log("Sin ADMIN_EMAIL/ADMIN_PASSWORD: no se crea administrador (se puede crear después con el mismo comando)");
  }
  console.log("✅ Listo");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
