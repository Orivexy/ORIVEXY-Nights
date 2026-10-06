# Estado del proyecto

Producto: **(Nombre en proceso)**, antes ORIVEXY Nights; el nombre definitivo está pendiente. Es una app de descubrimiento de vida nocturna (eventos, discotecas, clubs, conciertos y festivales), empezando por Barcelona.

Última revisión: 6 de octubre de 2026.

Este documento distingue entre lo **verificado** (con tests o probado de verdad) y lo que **no se ha podido verificar** porque depende de claves o cuentas externas.

## Auditoría inicial

Punto de partida: una aplicación ya funcional.
- Next.js 16 y React 19, PostgreSQL con Prisma 6.
- Sesiones propias con email/contraseña, Google OAuth y roles.
- Eventos con moderación, locales, mapa con MapLibre, búsqueda, feed social, panel de administración.
- Motor de importación de eventos: fuente → normalizar → validar → deduplicar → base de datos.
- Apps de escritorio con Electron.

Comprobaciones al empezar:
- `tsc`, `eslint` y 168 tests unitarios pasaban.
- No había `TODO`, `FIXME`, mocks, `console.log` ni datos inventados en `src/`.
- Todas las rutas `/api/admin/*` exigen rol de administrador o moderador en el servidor.
- Las mutaciones con cookie tienen comprobación de origen (CSRF) y límite de peticiones.

Lo que faltaba respecto al objetivo de producto:

| Prioridad | Falta | Estado |
| --- | --- | --- |
| IMPORTANTE | Artistas y DJs (line-up, página, seguir, búsqueda) | Hecho |
| IMPORTANTE | Borrador y vista previa antes de publicar | Hecho |
| IMPORTANTE | `sitemap.xml`, `robots.txt`, datos estructurados schema.org, Open Graph, Twitter y canonical | Hecho |
| IMPORTANTE | Métricas internas (vistas, búsquedas, guardados, clics en entradas, compartidos) | Hecho |
| IMPORTANTE | Recomendaciones personalizadas | Hecho |
| IMPORTANTE | Inicio con secciones de descubrimiento | Hecho |
| IMPORTANTE | Preferencias de notificaciones y géneros favoritos | Hecho |
| IMPORTANTE | Moderación: ocultar y spam | Hecho |
| IMPORTANTE | Estado «Evento finalizado» claro, sin acciones de compra | Hecho |
| MEJORA | Eventos similares, pestaña «Siguiendo», «Cerca de ti» opcional | Hecho |
| CRÍTICO (encontrado en e2e) | Con el nombre provisional, la cabecera se desbordaba 90–119 px en móvil | Corregido |
| CRÍTICO (encontrado en e2e) | Pestañas del perfil desbordadas en móvil | Corregido |
| IMPORTANTE (encontrado en e2e) | Al borrar una cuenta, el registro de auditoría fallaba por la clave foránea | Corregido |

## Completado y verificado

**Arquitectura `City → Venues → Events`**
- Las ciudades están en `src/config/cities.ts`.
- Barcelona no está fija en el código. Las últimas dos referencias se cambiaron a `site.defaultCitySlug`.

**Artistas**
- Modelos `Artist`, `EventArtist` y `ArtistFollow`.
- El line-up sale del formulario del organizador y del campo `performer` (schema.org) que publican las fuentes oficiales. Nunca se inventa.
- Se reconoce al mismo artista aunque varíen tildes, mayúsculas o espacios.
- Página `/artists/[slug]` con próximas fechas y eventos pasados, botón de seguir y búsqueda por nombre.
- Los seguidores reciben aviso cuando el artista tiene una fecha nueva.

**Crear evento**
- Ahora se guarda como borrador (`DRAFT`). La página del evento hace de vista previa privada, con el botón «Publicar».
- Al publicar se aplican las reglas de moderación: las cuentas nuevas pasan a revisión (`PENDING`).
- Los borradores no aparecen en listados, búsqueda ni sitemap, y un visitante no puede verlos (probado en e2e).

**Moderación**
- Estados: `DRAFT → PENDING → PUBLISHED`, más `REJECTED`, `CANCELLED` e `INACTIVE` (oculto).
- El esquema no tiene estados separados REVIEW y APPROVED: «en revisión» es `PENDING` y «aprobado» pasa directamente a `PUBLISHED`.
- El panel permite aprobar, rechazar, editar, ocultar y volver a mostrar, destacar, verificar, eliminar y marcar como spam.
- Spam rechaza el evento y suspende la cuenta si es de la comunidad.
- Todo se comprueba en el servidor y queda en el registro de auditoría.

**Página de evento**
- Line-up, eventos similares (por géneros o categoría) y «Más en este local».
- Aviso «Evento finalizado», sin botón de entradas ni de asistencia.
- Datos schema.org `Event` con precio, lugar, artistas y estado cancelado.
- Open Graph, Twitter y canonical (probado en e2e).

**SEO**
- `sitemap.xml` con eventos próximos, locales y artistas con fechas.
- `robots.txt` excluye las zonas privadas.
- Datos schema.org del local (`NightClub`, `MusicVenue`, etc.).

**Métricas internas** (`Interaction`)
- Registra vistas de evento, local y artista, búsquedas, guardados, clics en entradas y compartidos.
- No guarda IP, navegador ni ubicación.
- Las repeticiones del mismo usuario en 30 minutos cuentan una vez.
- Al borrar la cuenta, sus métricas quedan anónimas.
- El panel de administración muestra los últimos 7 días, los eventos más vistos y las búsquedas frecuentes.

**Recomendaciones**
- Puntuación explicable: popularidad, cercanía, géneros favoritos e historial, locales y artistas seguidos, y cuánto falta para el evento.
- Cada término está acotado para que ninguno domine al resto.
- Tiene tests unitarios.
- Si no sabemos nada del usuario, no se muestra la sección «Para ti».

**Inicio**
- Mapa grande con las discotecas.
- Secciones: «Para ti», «Esta noche», «Destacados», «Este fin de semana», «Cerca de ti», «Festivales», «Tendencia», «Recién anunciados», «Próximamente» y clubs.
- «Cerca de ti» solo usa la ubicación si el usuario la comparte; nunca se pide al cargar.
- Cada sección es una consulta a la base de datos y las vacías se ocultan.

**Mapa**
- `/map` vuelve a mostrar todos los lugares y eventos, con los filtros existentes.
- El mapa del inicio solo muestra discotecas y clubs, como se pidió antes.

**Perfil y ajustes**
- Géneros favoritos.
- Interruptor por tipo de notificación. Los avisos de cuenta y de moderación siempre llegan.
- Pestaña «Siguiendo» con los locales y artistas seguidos.

## Tests ejecutados (resultados reales)

| Comprobación | Resultado |
| --- | --- |
| `tsc --noEmit` | sin errores |
| `eslint .` | sin errores |
| `vitest run` | 174 tests, todos pasan (incluye los nuevos de artistas y recomendaciones) |
| `next build` (producción) | correcto |
| Playwright e2e, primera pasada | 40 pasan, 7 fallan. Los fallos eran el desbordamiento en móvil con el nombre provisional y tests desfasados; se corrigieron |
| Playwright e2e completo tras las correcciones | **48 de 48 pasan**: escritorio y móvil, registro, login, búsqueda, evento, guardar, seguir, crear evento con borrador y publicación, aprobación desde admin, seguridad de la API y responsive a 360/768 px |

## Pendiente o limitado

- **Google OAuth**: implementado, pero sin probar con una cuenta real. Necesita `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
- **Emails** (recuperar contraseña): implementado. Sin `SMTP_URL` el enlace se escribe en el log del servidor, no se envía.
- **Ticketmaster**: necesita `TICKETMASTER_API_KEY`. Sin clave, la fuente no se usa.
- **Fourvenues**: bloquea el acceso automático a su web («Hang on a sec», 403) y pide contactar para rastrear. No se ha integrado para no saltarse sus condiciones. Haría falta su API oficial o un acuerdo.
- **Xceed**: las páginas de algunos locales (Sutton, La Biblio, LAUT) solo enlazan 2 eventos en el HTML. Esas salas pueden mostrar pocos eventos.
- **Notificaciones push o por email**: solo hay notificaciones dentro de la app. Faltan servicio de push y SMTP.
- **Feed de vídeos**: existe (vertical, autoplay silenciado, carga diferida) y tiene tests de vídeo. No se ha rehecho en esta revisión.
- **Monitorización de errores** (Sentry o similar): no integrada. Los errores van a stdout o al log de escritorio.
- **Nombre del producto**: provisional. El repositorio sigue llamándose `ORIVEXY-Nights` hasta que el propietario lo renombre.

## Configuración necesaria (propietario)

Todas las variables están documentadas en `.env.example` y `.env.production.example`. Nunca se suben a Git.

**Obligatorias**
- `DATABASE_URL` (PostgreSQL 14 o superior).
- `APP_URL` (pública, con HTTPS en producción).
- `CRON_SECRET`.

**Opcionales**
- Google OAuth: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
- Email: `SMTP_URL` y `EMAIL_FROM`.
- Almacenamiento compartido: `S3_*`, obligatorio si hay varias instancias.
- Proveedor de mapas: `MAP_PROVIDER` y `MAPTILER_KEY` o `MAPBOX_TOKEN`. Por defecto se usa OpenFreeMap, sin clave.
- Ticketmaster: `TICKETMASTER_API_KEY`.
- Google Places: `GOOGLE_PLACES_API_KEY`.

## Cómo arrancar

```bash
cp .env.example .env
npm install
npm run db:deploy && npm run db:seed
npm run dev
```

## Cómo desplegar

- Guía completa en [docs/deployment.md](docs/deployment.md): Docker (`Dockerfile`, `docker-compose.yml`), migraciones con `npm run db:deploy`, HTTPS con proxy inverso, cabeceras de seguridad (CSP, HSTS), copias de seguridad de PostgreSQL y tareas programadas mediante `/api/cron/<job>` con `CRON_SECRET`.
- Las apps de escritorio se generan y publican desde GitHub Actions (`.github/workflows/desktop.yml`).
