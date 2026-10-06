# ORIVEXY NIGHTS production image.
#   docker build -t app .
# The `builder` stage also runs database migrations + the base seed
# (see docker-compose.yml → service "migrate").

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
COPY . .
# Public, non-secret build-time value: origin allowed by the CSP for media
# served straight from a CDN / public bucket (S3_PUBLIC_URL).
ARG S3_PUBLIC_URL=""
ENV S3_PUBLIC_URL=$S3_PUBLIC_URL NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# The build never connects to the database; a syntactically valid URL is enough.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg tini && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app && useradd --system --gid app --home /app app \
  && mkdir -p /app/storage && chown app:app /app/storage
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/app/storage FFMPEG_PATH=/usr/bin/ffmpeg
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
