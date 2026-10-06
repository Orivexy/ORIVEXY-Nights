-- ORIVEXY NIGHTS covers Barcelona only: other cities are hidden and their
-- sources paused (nothing is deleted; an admin can reactivate them).
UPDATE "City" SET "isActive" = false WHERE "slug" <> 'barcelona';
UPDATE "DiscoverySource" SET "enabled" = false WHERE "cityId" IN (SELECT "id" FROM "City" WHERE "slug" <> 'barcelona');

-- Barcelona official open data sources (no key).
INSERT INTO "DiscoverySource" ("id", "key", "name", "type", "enabled", "cityId", "trust", "autoPublish", "syncIntervalMin", "config", "updatedAt")
SELECT 'src_bcn_music_venues', 'bcn-open-data-music-venues', 'Ayuntamiento de Barcelona · espacios de música y copas', 'BCN_MUSIC_VENUES', true, c."id", 'IMPORTED', true, 1440, '{}'::jsonb, now()
FROM "City" c WHERE c."slug" = 'barcelona'
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "DiscoverySource" ("id", "key", "name", "type", "enabled", "cityId", "trust", "autoPublish", "syncIntervalMin", "config", "updatedAt")
SELECT 'src_catalonia_agenda_bcn', 'catalonia-agenda-bcn', 'Agenda cultural de Catalunya · conciertos, festivales y fiestas de Barcelona', 'CATALONIA_AGENDA', true, c."id", 'IMPORTED', true, 360, '{}'::jsonb, now()
FROM "City" c WHERE c."slug" = 'barcelona'
ON CONFLICT ("key") DO NOTHING;
