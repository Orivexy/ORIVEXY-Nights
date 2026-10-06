# Desarrollo de ORIVEXY NIGHTS

Guía técnica (el README del repositorio es solo para descargar la app).

- [Despliegue en producción](deployment.md)
- [Monetización](monetization.md)
- [Event Discovery](event-discovery.md)
- [Locales, horarios, eventos y mapa](places-and-map.md)
- [Apps de escritorio y móvil](desktop.md)

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js 16 (App Router, React 19, Server Components), TypeScript, Tailwind CSS 4 |
| Backend | Route Handlers de Next.js (API REST bajo `/api`), capa de servicios en `src/server/services` |
| Base de datos | PostgreSQL + Prisma 6 |
| Auth | Sesiones propias en BD (cookie httpOnly, token con hash SHA-256) · email + contraseña (bcrypt) · Google OAuth (PKCE, `arctic`) |
| Media | `sharp` (imágenes → WebP en 2 tamaños, sin EXIF/GPS, placeholder blur) · `ffmpeg` (vídeo → H.264 720p, `faststart`, póster) |
| Mapas | Abstracción `MapProvider` (renderer Leaflet) + clustering `supercluster`; teselas CARTO sin clave o Mapbox/MapTiler vía proxy en servidor |
| Tests | Vitest (unit) · Playwright (e2e) |
| Discovery | Locales y horarios de OpenStreetMap (Overpass), eventos de iCal, schema.org, feeds de partners y Ticketmaster; Google Places solo vincula IDs — ver docs |

## Puesta en marcha

Requisitos: Node ≥ 20.9 y PostgreSQL ≥ 14.

```bash
cp .env.example .env          # ajusta DATABASE_URL (y ADMIN_EMAIL/ADMIN_PASSWORD para tu admin)
npm install                   # instala deps + prisma generate (+ ffmpeg estático opcional)
npm run db:migrate            # crea el esquema
npm run db:seed               # datos base (idempotente): ciudades, categorías, géneros, fuentes, admin
npm run dev                   # http://localhost:3000
```

ORIVEXY NIGHTS no trae contenido de ejemplo: **no hay usuarios, locales ni eventos
inventados**. El seed solo crea la configuración base y, si defines
`ADMIN_EMAIL` + `ADMIN_PASSWORD`, la cuenta de administrador.

- **Locales y horarios**: se importan de OpenStreetMap en la primera
  sincronización (job `VENUE_SYNC`, visible en `/admin/map-data`; desde ahí se
  puede lanzar a mano).
- **Eventos**: fuentes de `/admin/discovery` (iCal, schema.org, feeds de
  partners, Ticketmaster con clave), locales y organizadores verificados
  (`/business`) y la comunidad.
- Si falta una clave de API, esa fuente aparece como no configurada; nunca se
  simulan respuestas.

Producción: ver [docs/deployment.md](deployment.md).

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` / `build` / `start` | Desarrollo / build de producción / servidor |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests end-to-end (Playwright; crean sus propios datos en una BD aislada, ver `tests/e2e/README.md`) |
| `npm run db:migrate` · `db:deploy` · `db:seed` · `db:reset` | Prisma |

## Arquitectura

```
prisma/
  schema.prisma           Modelo de datos normalizado
  seed/                   Datos base (sin contenido ficticio)
src/
  config/                 Marca, ciudades, categorías y géneros
  lib/                    Código compartido cliente/servidor (validadores zod, fechas, dinero, geo, tipos DTO)
  server/
    auth/                 Sesiones, contraseñas, proveedores OAuth
    services/             Lógica de negocio (eventos, locales, posts, usuarios, notificaciones, reportes, admin…)
    media/                Pipeline de imágenes y vídeo
    storage/              Almacenamiento de archivos: disco local o S3-compatible (S3, R2, MinIO)
    security/             Rate limiting
    jobs/                 Tareas periódicas (recordatorios, sincronización, limpieza de archivos)
    http.ts               Wrapper de rutas API: auth, roles, CSRF, rate limit, errores
  app/
    (app)/                Páginas con la navegación principal
    (auth)/               Login, registro y recuperación de contraseña
    admin/                Panel de administración
    api/                  API REST
    media/[...key]        Servidor de ficheros (con HTTP Range para vídeo)
  components/             UI por dominio (events, venues, feed, map, social, forms, admin, ui)
tests/                    unit/ y e2e/
```

Las páginas son Server Components que llaman directamente a la capa de servicios; las interacciones (likes, voy, seguir, comentar…) usan la API REST con actualizaciones optimistas. La misma API sirve para una futura app móvil.

### Modelo de datos

`Country → City → Venue/Event/Post/Profile`, `User ↔ Profile`, `Account` (OAuth), `Session`, `Event` (con `Category`, `EventGenre`, `EventAttendance` INTERESTED/GOING, `SavedEvent`), `Venue` (`VenueGenre`, `VenueFollow`, managers), `Review` (única por usuario y local, con subpuntuaciones), `Photo` / `Video`, `Post` (`PostTag`, `Comment`, `Like`, `SavedPost`), `Follow`, `Notification` (con `dedupeKey` para idempotencia), `Report` (FK a cada tipo de contenido).

Los contadores (likes, asistentes, media de valoración, seguidores…) están desnormalizados y se actualizan en transacciones.

### Multi-ciudad

Todo se filtra por `cityId`. Para añadir una ciudad basta con incluirla en `src/config/cities.ts` (o insertar una fila en `City`). La ciudad activa se guarda en una cookie elegida por el usuario; **nunca se infiere la ubicación sin permiso**. La geolocalización es opcional y solo se usa en el dispositivo para distancias y "Cerca de mí".

### "Hoy" en la noche

Una noche va de 06:00 a 06:00 hora local de la ciudad: una fiesta a la 01:00 del sábado aparece en "Hoy" el viernes (`src/lib/time.ts`).

### Feed vertical

- Scroll-snap vertical + `IntersectionObserver` para decidir el elemento activo.
- Solo el elemento activo reproduce; solo ±2 elementos montan `<video>` (memoria y datos).
- Vídeos transcodificados a H.264/AAC 720p con `faststart`, pósters WebP y soporte de HTTP Range.
- "Para ti": puntuación por interacción con decaimiento temporal, ponderada por ciudad y por gente que sigues. "Siguiendo": cronológico de usuarios y locales seguidos.
- Doble toque = like, teclas ↑/↓ y `m` (silencio) en escritorio.

### Mapas

`MapProvider` (`src/components/map/types.ts`) define la interfaz del mapa; hoy el renderer es Leaflet, con clustering, marcadores propios, filtros, búsqueda y tarjeta inferior. `MAP_PROVIDER` elige las teselas:

- `carto` (por defecto): teselas oscuras sin clave.
- `mapbox` / `maptiler`: las teselas pasan por `/api/map/tiles/{z}/{x}/{y}` para que la clave **nunca llegue al navegador**.

Para Mapbox GL o Google Maps basta con otro renderer que implemente `MapProviderProps`. Ver [docs/places-and-map.md](places-and-map.md).

### Moderación

- Reportes de usuario, evento, local, publicación, foto, vídeo y comentario (motivos: spam, inapropiado, acoso, evento falso, información incorrecta, otro). Uno por usuario y contenido.
- Con N reportes distintos (ajustable en `/admin/settings`) el contenido se oculta hasta revisión.
- Moderación de eventos (`/admin/settings`): `off` · `new_users` (cuentas de menos de 7 días pasan revisión) · `all`. Los eventos de locales y organizadores verificados se publican como oficiales.
- Bloqueo de usuarios: ni sus publicaciones ni sus comentarios aparecen a quien los bloquea.
- Panel `/admin` (roles MODERATOR/ADMIN): resumen, reportes (descartar, retirar, restaurar, suspender autor), eventos (aprobar, rechazar, destacar, editar, eliminar), usuarios (suspender, roles), locales (crear, editar ficha, destacar, desactivar), publicaciones, fuentes y sincronizaciones, solicitudes de negocio, auditoría y **ajustes** (registro abierto, sincronización, moderación y estado de cada servicio externo).

### Locales y organizadores

1. Desde `/business` un usuario solicita cuenta de **local** (eligiendo su ficha) u **organizador**.
2. Un admin la aprueba o rechaza en `/admin/businesses` (el usuario recibe una notificación).
3. Aprobado: rol ORGANIZER/VENUE, eventos publicados sin revisión y marcados como oficiales; el local puede editar su ficha en `/venues/<slug>/manage` (datos, horario, música, precios, portada y ubicación). Esos datos pasan a ser oficiales y las fuentes externas ya no los sobrescriben; cada cambio queda en el historial.

### Notificaciones

In-app (tabla `Notification`) para: nuevos seguidores, likes, comentarios, etiquetas, recordatorio "tu evento empieza en 2 horas", nuevo evento en un local que sigues y moderación. `registerNotificationChannel()` permite añadir push/email sin tocar el resto del código.

Tareas periódicas (`src/server/jobs`): se ejecutan dentro del proceso si `ENABLE_INPROCESS_JOBS=true`, o desde un cron externo:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/event-reminders
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/event-sync
```

Lista completa y frecuencias: [docs/deployment.md](deployment.md#6-tareas-periódicas).

## Seguridad

- Validación de toda entrada con zod (`src/lib/validators.ts`); textos normalizados.
- React escapa todo el contenido; no hay `dangerouslySetInnerHTML`. CSP estricta, `X-Frame-Options`, `nosniff`, HSTS en producción.
- Prisma parametriza todas las consultas (la única SQL manual usa `Prisma.sql`).
- Contraseñas con bcrypt (coste 12) y comparación de tiempo constante para emails inexistentes.
- Sesiones opacas en BD (solo se guarda el hash), cookie `httpOnly` + `SameSite=Lax` + `Secure` en producción; se invalidan al suspender una cuenta.
- CSRF: comprobación de `Origin` en todas las mutaciones.
- OAuth con `state` + PKCE; enlace de cuentas solo con email verificado.
- Autorización por recurso (solo el autor/organizador o moderadores editan/borran; las subidas solo las puede adjuntar su propietario).
- Rate limiting por IP/usuario (login, registro, subidas, comentarios, reportes…), interfaz lista para Redis.
- Subidas validadas por contenido real (se decodifica la imagen / se analiza el vídeo con ffmpeg), límites de tamaño y duración, metadatos eliminados.
- Antispam: honeypot en registro, límite de enlaces y duplicados en comentarios.
- Redirecciones solo relativas (sin open redirect). Secretos solo en variables de entorno del servidor.

## Rendimiento

- Server Components + consultas en paralelo y `select` mínimos; índices en las columnas de filtrado/orden.
- Imágenes pre-optimizadas (WebP 480/1280 px) servidas con caché inmutable y `next/image` con loader propio y placeholder blur.
- Compresión de fotos en el navegador antes de subir.
- Paginación por cursor + scroll infinito; skeletons y `loading.tsx`.
- Mapa cargado de forma diferida (solo cliente).

## Autenticación con Google

1. Crea un OAuth Client (Web) en Google Cloud.
2. URI de redirección: `{APP_URL}/api/auth/oauth/google/callback`.
3. Rellena `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. El botón aparece automáticamente.

Apple/TikTok: implementa `OAuthProvider` en `src/server/auth/oauth/providers.ts`.

## Cuentas

Registro con email y contraseña o Google, sesiones en BD, cerrar sesión (o en todos los dispositivos), cambio de contraseña, recuperación por email (`SMTP_URL` + `EMAIL_FROM`; si no está configurado la app lo dice) y eliminación de cuenta con sus archivos (`/settings`).

## Almacenamiento

`STORAGE_DRIVER=local` guarda en `STORAGE_LOCAL_DIR`; `STORAGE_DRIVER=s3` usa cualquier bucket S3-compatible (AWS S3, Cloudflare R2, MinIO, B2) con firma SigV4 propia, sin SDK. Los archivos nunca van a PostgreSQL. Un job diario borra archivos sin referencia en la BD. Si no hay ffmpeg disponible, los vídeos MP4/WebM se aceptan sin transcodificar.

## Escalado futuro

- Cola de trabajos (BullMQ) para transcodificar vídeo fuera de la petición.
- Rate limiting y caché en Redis al escalar horizontalmente (hoy en memoria por instancia).
- Búsqueda con `pg_trgm` / full-text sobre `searchText`.
