-- Brand renamed to ORIVEXY NIGHTS: brand-neutral ticketing enum value and
-- the technical account that owns imported events.
ALTER TYPE "TicketProvider" RENAME VALUE 'NIVEX' TO 'PLATFORM';

UPDATE "Profile" SET "username" = 'orivexy_discovery', "displayName" = 'ORIVEXY NIGHTS Discovery'
WHERE "username" = 'nivex_discovery'
  AND NOT EXISTS (SELECT 1 FROM "Profile" WHERE "username" = 'orivexy_discovery');
