#!/usr/bin/env bash
# Builds the ORIVEXY NIGHTS desktop app (desktop/).
#
#   scripts/build-desktop.sh                     # Windows installer (cross-built on Linux) → dist-desktop/ORIVEXY-NIGHTS-Windows.exe
#   scripts/build-desktop.sh --platform linux    # on Linux x64 → dist-desktop/ORIVEXY-NIGHTS-Linux.AppImage
#   scripts/build-desktop.sh --platform mac      # on an Apple Silicon Mac → dist-desktop/ORIVEXY-NIGHTS-Mac.dmg
#   scripts/build-desktop.sh --base-data FILE    # reuse a base-data.sql (no PostgreSQL needed)
#   scripts/build-desktop.sh --snapshot DIR      # bundle public source data (scripts/record-snapshot.mts)
#   scripts/build-desktop.sh --resources-only [--keep-host-natives]
#
# Requires: Node 20+, a local PostgreSQL (to build the base configuration,
# unless --base-data is given) and network access to the npm registry and
# GitHub releases. Windows also needs python3 + pip (Visual C++ runtime) and
# wine (NSIS on Linux) or NSIS_DOCKER=1.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$PWD"
DESK="$ROOT/desktop"
RES="$DESK/resources"
WORK="$DESK/.build"
RESOURCES_ONLY=false
KEEP_HOST=false
PLATFORM=win
BASE_DATA=""
SNAPSHOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --resources-only) RESOURCES_ONLY=true ;;
    --keep-host-natives) KEEP_HOST=true ;;
    --platform) PLATFORM="$2"; shift ;;
    --base-data) BASE_DATA="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift ;;
    --snapshot) SNAPSHOT="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
case "$PLATFORM" in win|linux|mac) ;; *) echo "--platform must be win, linux or mac" >&2; exit 1 ;; esac
# Linux and Mac are built on their own OS, with the host's native modules.
[ "$PLATFORM" != win ] && KEEP_HOST=true

MSVC_RUNTIME_VERSION="14.44.35112"
BUILD_DB_URL="${BUILD_DATABASE_URL:-postgresql://nightly:nightly@localhost:5432/app_desktop_build}"
BUILD_DB_NAME="${BUILD_DB_URL##*/}"; BUILD_DB_NAME="${BUILD_DB_NAME%%\?*}"
ADMIN_DB_URL="${BUILD_DB_URL%/*}/postgres"

BASE="$WORK/base"
rm -rf "$BASE" && mkdir -p "$BASE"
if [ -n "$BASE_DATA" ]; then
  echo "▸ 1/5 Base data (from $BASE_DATA)"
  cp "$BASE_DATA" "$BASE/base-data.sql"
else
  echo "▸ 1/5 Base data (fresh database $BUILD_DB_NAME: migrations + seed, no content)"
  psql "$ADMIN_DB_URL" -qc "DROP DATABASE IF EXISTS \"$BUILD_DB_NAME\"" -c "CREATE DATABASE \"$BUILD_DB_NAME\""
  DATABASE_URL="$BUILD_DB_URL" npx prisma migrate deploy >/dev/null
  DATABASE_URL="$BUILD_DB_URL" ADMIN_EMAIL="" ADMIN_PASSWORD="" npx prisma db seed >/dev/null
  DATABASE_URL="$BUILD_DB_URL" npx tsx scripts/export-base-data.mts > "$BASE/base-data.sql"
fi

echo "▸ 2/5 Next.js standalone server"
rm -rf .next
# The build never connects to the database; a syntactically valid URL is enough.
DATABASE_URL="${DATABASE_URL:-postgresql://build:build@localhost:5432/build}" NEXT_OUTPUT=standalone APP_URL="http://localhost:3000" NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null

echo "▸ 3/5 Assembling resources"
rm -rf "$RES" && mkdir -p "$RES/bin"
cp -r .next/standalone "$RES/server"
mkdir -p "$RES/server/.next" && cp -r .next/static "$RES/server/.next/static"
cp -r public "$RES/server/public"
rm -f "$RES/server/.env" # never ship local secrets
rm -rf "$RES/server/src" "$RES/server/prisma" "$RES/server/tests" "$RES/server/desktop" # traced by accident, not needed at runtime
# Schema (applied by the app on start, like `prisma migrate deploy`) and base configuration.
mkdir -p "$RES/migrations" && cp -r prisma/migrations/2* "$RES/migrations/"
cp "$BASE/base-data.sql" "$RES/"
if [ -n "$SNAPSHOT" ] && [ -d "$SNAPSHOT" ] && ls "$SNAPSHOT"/*.gz >/dev/null 2>&1; then
  cp -r "$SNAPSHOT" "$RES/snapshot"
  echo "   datos iniciales: $(ls "$RES/snapshot"/*.gz | wc -l) respuestas, $(du -sh "$RES/snapshot" | cut -f1)"
else
  echo "   (sin datos iniciales: el mapa se llenará con la primera sincronización)"
fi

echo "▸ 4/5 Native binaries ($PLATFORM)"
PACKS="$WORK/packs" && rm -rf "$PACKS" && mkdir -p "$PACKS"
pkg_version() { node -p "JSON.parse(require('fs').readFileSync('$1/package.json','utf8')).version"; }
fetch_pkg() { # name@version → extracted dir
  (cd "$PACKS" && npm pack "$1" --silent >/dev/null)
  local tgz; tgz=$(ls -t "$PACKS"/*.tgz | head -1)
  local out="$PACKS/$(basename "$tgz" .tgz)"; mkdir -p "$out"
  tar -xzf "$tgz" -C "$out" --strip-components=1 && rm "$tgz"
  echo "$out"
}
if [ "$PLATFORM" = win ]; then
  SHARP_VERSION=$(pkg_version node_modules/sharp)
  SHARP_WIN=$(fetch_pkg "@img/sharp-win32-x64@$SHARP_VERSION")
  mkdir -p "$RES/server/node_modules/@img" && rm -rf "$RES/server/node_modules/@img/sharp-win32-x64" && cp -r "$SHARP_WIN" "$RES/server/node_modules/@img/sharp-win32-x64"
  mkdir -p "$RES/server/node_modules/.prisma/client"
  cp node_modules/.prisma/client/query_engine-windows.dll.node "$RES/server/node_modules/.prisma/client/"
  FF=$(fetch_pkg "@ffmpeg-installer/win32-x64") && cp "$FF/ffmpeg.exe" "$RES/bin/"
fi
if [ "$KEEP_HOST" = false ]; then
  # Drop host (Linux) natives from the Windows bundle.
  rm -rf "$RES/server/node_modules/@img/sharp-linux"* "$RES/server/node_modules/@img/sharp-libvips-linux"* \
         "$RES/server/node_modules/@ffmpeg-installer"
  find "$RES/server/node_modules" -name "*.so.node" -delete
else
  # Host ffmpeg (optional: without it videos are stored as uploaded).
  for tool in ffmpeg; do
    src=$(node -p "try { require('@$tool-installer/$tool').path } catch { '' }")
    if [ -n "$src" ] && [ -f "$src" ]; then cp "$src" "$RES/bin/$tool"; chmod +x "$RES/bin/$tool"; else echo "   ($tool not available for this platform: videos won't be transcoded)"; fi
  done
  [ "$PLATFORM" != win ] && rm -rf "$RES/server/node_modules/@ffmpeg-installer"
fi

# Smaller download, faster install: drop what the server never loads.
NM="$RES/server/node_modules"
# Prisma: the Node-API engine (library.js + one native engine) is used; not the
# WebAssembly/edge/binary variants for other databases and runtimes.
rm -f "$NM/@prisma/client/runtime/"*wasm* "$NM/@prisma/client/runtime/"edge* "$NM/@prisma/client/runtime/"react-native* \
      "$NM/@prisma/client/runtime/"binary.* "$NM/.prisma/client/"*.wasm "$NM/.prisma/client/wasm."* "$NM/.prisma/client/edge."*
[ "$PLATFORM" != win ] && rm -f "$NM/.prisma/client/"*windows*
# sharp: glibc builds only (no musl, no WebAssembly fallback).
rm -rf "$NM/@img/sharp-linuxmusl"* "$NM/@img/sharp-libvips-linuxmusl"* "$NM/@img/sharp-wasm32"
# Source maps, type declarations and changelogs (licences are kept).
find "$NM" \( -name "*.map" -o -name "*.d.ts" -o -iname "CHANGELOG*" -o -iname "README*" \) -type f -delete 2>/dev/null || true
# Build traces and source maps of the app itself are not read at runtime.
find "$RES/server/.next" \( -name "*.nft.json" -o -name "*.map" \) -type f -delete 2>/dev/null || true
du -sh "$RES"/* | sed 's/^/   /'

# PostgreSQL: server, initdb and pg_ctl are enough — no pgAdmin GUI libraries,
# message translations, headers or client/ecpg libraries.
prune_postgres() {
  local pg="$1"
  [ -d "$pg" ] || return 0
  rm -rf "$pg/share/locale" "$pg/include" "$pg/share/doc" "$pg/share/man"
  # Only the built-in PL/pgSQL extension is used (initdb installs it).
  find "$pg/share/extension" -type f ! -name "plpgsql*" -delete 2>/dev/null || true
  rm -f "$pg"/bin/wx*.dll "$pg"/bin/testplug.dll "$pg"/bin/libecpg*.dll "$pg"/bin/libpgtypes.dll "$pg"/lib/*.lib "$pg"/lib/*.a "$pg"/lib/libecpg* "$pg"/lib/libpgtypes*
}

[ "$RESOURCES_ONLY" = true ] && { echo "✔ Resources ready in desktop/resources"; exit 0; }

cd "$DESK"
npm install --no-audit --no-fund >/dev/null
for pg in "$DESK"/node_modules/@embedded-postgres/*/native; do prune_postgres "$pg"; done
case "$PLATFORM" in
  linux)
    echo "▸ 5/5 Linux AppImage"
    npx electron-builder --linux AppImage --x64 --publish never
    ;;
  mac)
    echo "▸ 5/5 macOS dmg"
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 --publish never
    ;;
  win)
    echo "▸ 5/5 Windows installer"
    npm install --no-save --force --no-audit --no-fund "@embedded-postgres/windows-x64@$(pkg_version node_modules/embedded-postgres)" >/dev/null
    # PostgreSQL for Windows links against the Visual C++ runtime, which is not
    # part of a clean Windows install: ship the redistributable DLLs app-locally.
    MSVC="$WORK/msvc" && rm -rf "$MSVC" && mkdir -p "$MSVC"
    python3 -m pip download --quiet --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.12 \
      -d "$MSVC" "msvc-runtime==$MSVC_RUNTIME_VERSION"
    (cd "$MSVC" && python3 -m zipfile -e ./*.whl .)
    prune_postgres "$DESK/node_modules/@embedded-postgres/windows-x64/native"
    PG_BIN="$DESK/node_modules/@embedded-postgres/windows-x64/native/bin"
    for dll in vcruntime140.dll vcruntime140_1.dll msvcp140.dll msvcp140_1.dll msvcp140_2.dll; do
      cp "$(find "$MSVC" -path "*/Scripts/$dll" | head -1)" "$PG_BIN/"
    done
    if [ "${NSIS_DOCKER:-0}" = 1 ]; then
      # CI: electron-builder's official image ships the wine needed for NSIS.
      docker run --rm -v "$ROOT:/project" -w /project/desktop -e ELECTRON_CACHE=/project/desktop/.build/electron-cache \
        electronuserland/builder:wine npx electron-builder --win nsis --x64 --publish never
    else
      npx electron-builder --win nsis --x64 --publish never
    fi
    ;;
esac
echo "✔ Package in dist-desktop/"
