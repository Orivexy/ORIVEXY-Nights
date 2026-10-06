-- ORIVEXY NIGHTS shows only discotecas and their events (for now).
-- Nothing is deleted: hidden rows can be reactivated from the admin panel.

-- Cultural agenda (concerts, opera, festivals…) off, and its events hidden.
UPDATE "DiscoverySource" SET "enabled" = false WHERE "type" = 'CATALONIA_AGENDA';
UPDATE "Event" SET "status" = 'INACTIVE'
WHERE "status" = 'PUBLISHED' AND "source" = 'IMPORT'
  AND "primarySourceId" IN (SELECT "id" FROM "DiscoverySource" WHERE "type" = 'CATALONIA_AGENDA');

-- Imported events not at a discoteca (e.g. Ticketmaster concerts) hidden.
UPDATE "Event" e SET "status" = 'INACTIVE'
WHERE e."status" = 'PUBLISHED' AND e."source" = 'IMPORT'
  AND NOT EXISTS (SELECT 1 FROM "Venue" v WHERE v."id" = e."venueId" AND v."type" = 'CLUB')
  AND e."primarySourceId" IN (SELECT "id" FROM "DiscoverySource" WHERE "type" IN ('TICKETMASTER', 'CATALONIA_AGENDA'));

-- OpenStreetMap and Google: only nightclubs.
UPDATE "DiscoverySource" SET "config" = COALESCE("config", '{}'::jsonb) || '{"categories": ["nightclub", "dance_club"]}'::jsonb, "nextSyncAt" = now()
WHERE "type" = 'OSM_OVERPASS';
UPDATE "DiscoverySource" SET "config" = COALESCE("config", '{}'::jsonb) || '{"categories": ["nightclub"]}'::jsonb
WHERE "type" = 'GOOGLE_PLACES';

-- Imported places that are not discotecas (music bars, karaokes, concert rooms…) leave the map.
UPDATE "Venue" SET "isActive" = false
WHERE "isActive" = true AND "type" <> 'CLUB' AND "trust" = 'IMPORTED';
UPDATE "DiscoverySource" SET "nextSyncAt" = now() WHERE "type" = 'BCN_MUSIC_VENUES';
