#!/usr/bin/env bash
# Starts ORIVEXY NIGHTS for the end-to-end tests against an ISOLATED database that is
# recreated on every run (never the development or production database):
# schema migrations → base seed (+ test admin) → test fixtures → `next start`.
# Requires a previous `npm run build`.
set -euo pipefail
cd "$(dirname "$0")/.."

E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql://nightly:nightly@localhost:5432/app_e2e}"
DB_NAME="${E2E_DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
case "$DB_NAME" in *e2e*|*test*) ;; *) echo "Refusing to reset '$DB_NAME': the e2e database name must contain 'e2e' or 'test'." >&2; exit 1 ;; esac
ADMIN_URL="${E2E_DATABASE_URL%/*}/postgres"
PORT="${E2E_PORT:-3100}"

psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" -c "CREATE DATABASE \"$DB_NAME\""
rm -rf ./storage-e2e

export DATABASE_URL="$E2E_DATABASE_URL" APP_URL="http://localhost:$PORT" STORAGE_DRIVER=local STORAGE_LOCAL_DIR=./storage-e2e \
  ENABLE_INPROCESS_JOBS=false DISCOVERY_ENABLED=false RATE_LIMIT_SCALE=50 CRON_SECRET=e2e-cron-secret-0123456789 \
  EVENT_MODERATION=new_users SMTP_URL= EMAIL_FROM= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= FIRST_USER_IS_ADMIN=false \
  TICKETMASTER_API_KEY= GOOGLE_PLACES_API_KEY= MAP_PROVIDER="${MAP_PROVIDER:-openfreemap}" \
  ADMIN_EMAIL=admin@e2e.test ADMIN_PASSWORD=e2e-admin-pass-123 ADMIN_USERNAME=e2eadmin

npx prisma migrate deploy >/dev/null
npx prisma db seed >/dev/null
npx tsx --conditions=react-server tests/e2e/fixtures.mts
exec npx next start -p "$PORT"
