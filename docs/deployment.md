# Despliegue en producción

Checklist y pasos para publicar ORIVEXY NIGHTS en un servidor propio o en un PaaS.
El estado real de cada servicio se ve en **/admin/settings → Servicios**.

## 1. Requisitos

| Pieza | Mínimo | Notas |
| --- | --- | --- |
| Node.js | 22 LTS | o la imagen Docker incluida |
| PostgreSQL | 14+ (recomendado 16) | con copias de seguridad diarias |
| Almacenamiento | disco persistente o bucket S3-compatible | S3/R2 obligatorio con varias instancias |
| ffmpeg | opcional | sin él los vídeos se guardan sin transcodificar |
| HTTPS | obligatorio | proxy inverso con TLS (Caddy, nginx, Traefik) o el del PaaS |

## 2. Variables de entorno

Plantilla: [`.env.production.example`](../.env.production.example). Cópiala a
`.env.production` **en el servidor** (está en `.gitignore`) o carga los valores
en el gestor de secretos del proveedor. Nunca subas claves reales a Git.

Imprescindibles:

- `APP_URL` → URL pública `https://…` (cookies `Secure`, OAuth, enlaces de email).
- `DATABASE_URL` (o `POSTGRES_*` con docker compose).
- `ADMIN_EMAIL` + `ADMIN_PASSWORD` → administrador inicial (lo crea el seed).
- `CRON_SECRET` → `openssl rand -hex 32` (protege `/api/cron/*`).
- `SMTP_URL` + `EMAIL_FROM` → recuperación de contraseña. Sin ellos la app
  muestra que la recuperación no está disponible (no finge enviar nada).
- Almacenamiento: `STORAGE_DRIVER=s3` + `S3_*`, o `local` con un volumen persistente.

Opcionales (sin ellos la función correspondiente aparece como no configurada,
nunca con datos inventados): `GOOGLE_CLIENT_ID/SECRET`, `TICKETMASTER_API_KEY`,
`GOOGLE_PLACES_API_KEY`, `MAP_PROVIDER` + `MAPBOX_TOKEN`/`MAPTILER_KEY`.

Desarrollo y producción están separados: `.env` (desarrollo, a partir de
`.env.example`) y `.env.production` (producción). `FIRST_USER_IS_ADMIN` es solo
para la app de escritorio: déjalo en `false` en un sitio público.

## 3. Base de datos

```bash
npx prisma migrate deploy   # aplica las migraciones pendientes (idempotente)
npx prisma db seed          # datos base: países, ciudades, categorías, géneros,
                            # planes, fuentes de descubrimiento y admin inicial
```

El seed es idempotente (se puede ejecutar en cada despliegue) y **no crea
usuarios, locales ni eventos ficticios**. Los locales llegan de OpenStreetMap en
la primera sincronización; los eventos, de las fuentes configuradas en
`/admin/discovery`, de los locales/organizadores verificados y de la comunidad.

Nunca uses `prisma migrate dev` ni `prisma migrate reset` contra producción.

## 4. Opción A — Docker Compose (un servidor)

```bash
cp .env.production.example .env.production     # rellena los valores
docker compose --env-file .env.production up -d --build
```

- `db`: PostgreSQL 16 con volumen `db-data`.
- `migrate`: ejecuta `migrate deploy` + seed y termina; `app` no arranca si falla.
- `app`: servidor Next.js *standalone* (usuario sin privilegios, `tini`,
  healthcheck en `/api/health`, ffmpeg incluido, volumen `media` para `local`).
- Escucha en `127.0.0.1:3000`: pon delante el proxy con TLS. Ejemplo Caddy:

```
app.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Si usas `S3_PUBLIC_URL`, pásalo también en el build (`args`) para que la CSP
permita cargar imágenes y vídeos desde ese dominio.

## 5. Opción B — PaaS (Railway, Render, Fly.io…) o VPS sin Docker

```bash
npm ci
NEXT_OUTPUT=standalone npm run build
npx prisma migrate deploy && npx prisma db seed     # comando de "release"
node .next/standalone/server.js                     # copia antes .next/static y public (ver Dockerfile)
```

O simplemente usa el `Dockerfile` (casi todos los PaaS lo detectan).

## 6. Tareas periódicas

| Tarea | Frecuencia | Qué hace |
| --- | --- | --- |
| `event-reminders` | 5 min | Aviso "tu evento empieza en 2 h" |
| `event-sync` / `venue-sync` / `venue-hours-sync` | 1 min (cada job decide si le toca, con backoff) | Sincronización de eventos, locales y horarios |
| `cleanup-uploads` | 1 h | Borra subidas nunca adjuntadas (> 24 h) |
| `sweep-storage` | 24 h | Borra archivos del almacenamiento sin fila en la BD (> 24 h) |
| `end-promotions` | 1 h | Finaliza promociones caducadas |
| `discovery-maintenance` | 24 h | Purga datos de fuentes caducados |

- **Una instancia**: `ENABLE_INPROCESS_JOBS=true` (por defecto) y no hace falta nada más.
- **Varias instancias o serverless**: `ENABLE_INPROCESS_JOBS=false` y un cron externo:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/event-sync
```

  Ejemplo crontab: `* * * * *` para `event-sync`, `venue-sync`, `venue-hours-sync`;
  `*/5 * * * *` para `event-reminders`; `0 * * * *` para `cleanup-uploads` y
  `end-promotions`; `30 4 * * *` para `sweep-storage` y `discovery-maintenance`.
  Los jobs de sincronización usan un *lease* en la BD: nunca se ejecutan dos a la vez.

## 7. Almacenamiento S3 / R2

1. Crea un bucket privado (Cloudflare R2, AWS S3, Backblaze B2, MinIO…).
2. Crea una clave con permisos solo sobre ese bucket: `PutObject`, `GetObject`,
   `DeleteObject`, `ListBucket`.
3. `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   `S3_REGION` (`auto` en R2, p. ej. `eu-west-1` en AWS) y `S3_ENDPOINT` si no es AWS.
4. Opcional: dominio público/CDN del bucket en `S3_PUBLIC_URL`; `/media/*`
   redirige allí en vez de pasar los bytes por el servidor.

Las subidas se validan en el servidor decodificando el archivo (no se confía
en la extensión ni en el MIME del navegador), con límites de tamaño/duración, y
se eliminan los metadatos (EXIF/GPS).

## 8. OAuth de Google

Google Cloud Console → Credentials → OAuth client (Web):
URI de redirección `{APP_URL}/api/auth/oauth/google/callback`. Rellena
`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`; el botón aparece solo.

## 9. Logs y errores

- El servidor escribe en stdout/stderr (recógelo con `docker compose logs -f app`
  o el visor del PaaS). Los errores no controlados se registran con `[api]`, los
  de almacenamiento con `[media]` y los de tareas con `[jobs]`.
- Acciones administrativas: **/admin/audit** (sin contraseñas ni tokens: se redactan).
- Sincronizaciones: **/admin/map-data** y **/admin/event-data** (ejecuciones, errores, cuotas).
- Monitor de disponibilidad: `GET /api/health`.

## 10. Checklist final

- [ ] `APP_URL` con `https://` y certificado válido.
- [ ] `migrate deploy` sin errores; seed ejecutado; admin creado (luego quita `ADMIN_PASSWORD` del entorno).
- [ ] `/admin/settings` → todos los servicios necesarios en verde.
- [ ] SMTP probado con "¿Has olvidado tu contraseña?".
- [ ] Subida de foto y vídeo probada (y visible tras reiniciar el contenedor).
- [ ] `/admin/map-data`: la primera sincronización de locales terminó OK.
- [ ] Copias de seguridad de PostgreSQL (y del volumen `media` si usas `local`).
