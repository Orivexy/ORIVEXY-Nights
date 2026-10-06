# Event Discovery

Sistema automático para descubrir eventos y locales (inicialmente Barcelona) y convertirlos al formato de ORIVEXY NIGHTS.

```
FUENTES → DISCOVERY ENGINE → NORMALIZACIÓN → DEDUPLICACIÓN → VALIDACIÓN → BASE DE DATOS → FRONTEND
```

Código: `src/server/discovery/` · Panel: `/admin/discovery`.

## Reglas

- Solo **APIs oficiales, feeds públicos y datos estructurados** que las propias webs publican (schema.org). Nada de scraping de buscadores, CAPTCHAs, logins, paywalls ni reintentos ante bloqueos (403/429 → error y espera).
- Las webs se leen respetando `robots.txt`, con User-Agent propio (`OrivexyNightsBot/1.0`), una petición por host cada 1,5 s, tiempo y tamaño máximos, y bloqueo de IPs privadas (SSRF).
- **No se inventan datos**: si falta el precio, la hora o el lugar, queda vacío o el evento va a revisión.
- Los usuarios nunca provocan consultas externas: todo se sincroniza en segundo plano y se sirve desde la base de datos.

## Fuentes (`DiscoverySource`)

| Tipo | Uso | Configuración |
| --- | --- | --- |
| `ICS_FEED` | Calendarios iCal públicos (webs de clubs, calendarios públicos de Google Calendar) | `url` |
| `JSON_LD_PAGE` | Agenda de la web oficial con datos schema.org (Event, MusicEvent, NightClub…) | `url`, `config.pages` |
| `PARTNER_FEED` | Feed JSON que nos da un club o promotor (formato abajo) | `url` |
| `TICKETMASTER` | Ticketmaster Discovery API | `TICKETMASTER_API_KEY`, `config.classificationName`, `config.keyword` |
| `OSM_OVERPASS` | Locales, direcciones y horarios de OpenStreetMap (ODbL) | sin clave; `config.categories`, `config.radiusKm` |
| `MADRID_AGENDA` | Agenda de datos abiertos del Ayuntamiento de Madrid (conciertos, fiestas, baile, ferias; se actualiza a diario) | sin clave; `url` (por defecto el JSON oficial) |
| `CATALONIA_AGENDA` | Agenda cultural de Catalunya (Generalitat, Socrata): conciertos, festivales, fiestas y festes majors de Barcelona, con precio, horario, lugar y enlace de compra; diaria | sin clave; `config.municipality` (por defecto Barcelona) |
| `BCN_MUSIC_VENUES` | Ayuntamiento de Barcelona · espacios de música y copas: discotecas, bares musicales, cocteleras… con dirección, teléfono y horario oficial; semanal | sin clave (CKAN datastore, CC BY 4.0) |
| `CURATED` | **Listado verificado** de lugares (`src/server/discovery/curated/barcelona.ts`): la única fuente de locales de Barcelona | sin clave; `config.list`, `config.listedVenuesOnly` |
| `GOOGLE_PLACES` | Vincula place IDs de Google y detecta cierres (Places API New) | `GOOGLE_PLACES_API_KEY`, `config.categories` |

Cada fuente tiene: nombre, tipo, activada, ciudad, local propietario, confianza (`IMPORTED`/`OFFICIAL`), publicación automática, permiso de imágenes, intervalo, estado, último error, última sincronización y eventos encontrados. Cada sincronización queda en `SyncRun` con sus contadores y un registro.

**Google**: no existe una API pública de eventos de Google y no se hace scraping de sus resultados. Places solo se usa para vincular locales (place ID) y detectar cierres, porque sus condiciones no permiten guardar ni mostrar su contenido en un mapa que no sea de Google. Los locales, sus datos y sus horarios vienen de OpenStreetMap. Detalles en [places-and-map.md](places-and-map.md).

**Listado verificado de Barcelona (`CURATED`).** Sustituye a todos los locales anteriores (OpenStreetMap, lista del Ayuntamiento y agenda de la Generalitat quedan desactivadas). Cada lugar del listado se comprobó a mano en su web oficial y en al menos otra fuente con actividad en 2026 (`sources`, `verifiedAt`); los que están cerrados, han cambiado de nombre o no están en Barcelona van en `EXCLUDED` con el motivo. En el listado solo hay datos de esas fuentes: nombre, tipo (Discoteca, Club, Sala de conciertos, Sala de eventos, Espacio para festivales), dirección, descripción corta, música/eventos, web, alias y estado. En cada sincronización:

- **Ubicación, barrio y distrito**: OpenStreetMap Nominatim para la dirección publicada (solo si cambia; 1 petición/s). Sin resultado → el lugar no se muestra.
- **Fotos**: las de la web oficial (og:image, fotos del JSON-LD del local y fotos grandes de la página, sin logos ni iconos; mínimo 500 px), importadas una vez; la primera es la portada y el resto la galería «Fotos · de su web oficial». Si la web no tiene, las de su ficha de Xceed (`photoPages`). Si tampoco, portada ilustrada: nunca una foto genérica.
- **Instagram, horario y precio**: los que publique la web oficial (enlace a Instagram, `openingHoursSpecification`, `priceRange`). Si no los publica, la ficha dice «no verificado» o muestra el precio más bajo de sus próximos eventos.
- **Eventos**: los schema.org de su web oficial, más Xceed y Ticketmaster. Todas estas fuentes tienen `config.listedVenuesOnly`: solo entran eventos en un lugar del listado (por nombre, alias como «Pacha» → Ku Barcelona, o coordenadas), de cualquier tipo: fiestas, conciertos, sesiones DJ, festivales, eventos especiales y noches temáticas.
- Los locales que no están en el listado se retiran del mapa.
- **Zonas del local (red neuronal)**: `scripts/classify-zones.mts` pasa las fotos oficiales por CLIP ViT-B/32 cuantizado (Transformers.js, CPU) en modo zero-shot con las descripciones de `src/lib/zones.ts` (pista, cabina del DJ, zona VIP, barra, escenario, terraza, entrada). Solo se guarda la zona si la confianza supera `ZONE_MIN_SCORE`; carteles, logos y primeros planos quedan sin zona. CI lo ejecuta tras la instantánea y la app incluye el resultado (`snapshot/zones.json`), que se aplica a las mismas fotos por su URL de origen; en la app no se ejecuta ningún modelo. La ficha lo indica como «detectado automáticamente».
- **Comprobaciones**: la ubicación de OpenStreetMap debe estar en el municipio del local y a menos de 15 km (si no, se prueba la dirección; si tampoco, no se muestra), y el Instagram de la web solo se acepta si el nombre de la cuenta corresponde al local.
- **Locales principales** (`MAIN_VENUES`, elegidos por el propietario): se marcan como destacados y salen siempre primero en la lista de ocio nocturno, en el inicio y en el mapa.

`config.nightlifeOnly` (Ticketmaster): solo eventos en discotecas (local de tipo CLUB o nombre de club conocido); fuera conciertos en auditorios, festivales, fiestas populares, ópera, teatro y restaurantes.

**Xceed** (`JSON_LD_PAGE`, clave `xceed-barcelona-clubs`): lee la agenda pública de Barcelona y cada página de evento enlazada (`config.followLinks`), con los datos schema.org que Xceed publica para buscadores; respeta robots.txt, va despacio, se identifica y enlaza a Xceed para comprar. Además de la agenda general lee las páginas de Xceed de los locales del listado (`config.pages`); con `listedVenuesOnly` solo guarda los eventos de esos locales (`config.nightClubsOnly`, ya sin uso en Barcelona, deja solo los de una `NightClub`). Fourvenues bloquea a los bots (HTTP 403), así que no se usa. `config.authoritative` (lista del Ayuntamiento): los locales que salen de la lista (o del filtro de ocio nocturno) se retiran del mapa. Las fotos de los eventos son las oficiales de la fuente (`allowImages`); si no hay, se muestra una portada ilustrada por categoría (nunca una foto inventada).

Las fuentes con clave (Ticketmaster, Google) vienen activadas pero **esperan su clave**: no se ejecutan ni dan error hasta que se configura, y entonces empiezan solas.

## Sincronización

- Jobs `EVENT_SYNC` (eventos) y `VENUE_SYNC` / `VENUE_HOURS_SYNC` (locales). Se ejecutan en proceso o con `POST /api/cron/event-sync`, `/venue-sync` o `/venue-hours-sync` y `CRON_SECRET`. Ver [places-and-map.md](places-and-map.md#jobs-srcserversyncjobsts).
- Intervalo: `syncIntervalMin` de la fuente, o `EVENT_SYNC_INTERVAL` / `VENUE_SYNC_INTERVAL` (`30m`, `2h`, `1d`). Tras un error, el reintento es exponencial (30 min, 1 h, 2 h…), con un tope.
- Un bloqueo en base de datos evita sincronizar la misma fuente dos veces a la vez.
- `DISCOVERY_ENABLED=false` detiene el motor.

## Normalización (`normalize.ts`)

- Títulos: `"SATURDAY NIGHT @ CLUB XYZ - 23:30"` → título *Saturday Night*, local *Club XYZ*, hora 23:30 (la hora del título solo se usa si la fuente no da hora).
- Horas en la zona de la ciudad (`Europe/Madrid`); un fin anterior al inicio pertenece al día siguiente (viernes 23:30 → sábado 06:00).
- Géneros solo desde campos de género o el título; categoría (FM, festival, concierto, DJ, discoteca, fiesta).
- Precios solo si la fuente los indica. Texto sin HTML. URLs solo http(s).

## Deduplicación (`dedupe.ts`)

Puntuación con título (sin palabras genéricas ni el nombre del local), local o distancia, hora, organizador y URLs. ≥ 0,75 → es el mismo evento (se enlaza la nueva fuente); 0,5–0,75 → revisión como “posible duplicado”. Todas las fuentes de un evento quedan en `SourceEventRecord`. Los locales se deduplican por `googlePlaceId`, nombre normalizado y coordenadas.

## Actualizaciones

La **fuente principal** de un evento puede cambiar cualquier campo; las demás solo rellenan huecos. Una fuente `OFFICIAL` pasa a ser la principal de un evento importado. Los eventos creados dentro de ORIVEXY NIGHTS nunca se sobrescriben. Cada cambio queda en `EventChange` (campo, antes, después, fuente, fecha). Si la fuente deja de listar un evento en dos sincronizaciones correctas, se oculta (`INACTIVE`); nunca si la fuente devuelve 0 resultados de golpe.

## Verificación

`COMMUNITY` (creado por un usuario) · `IMPORTED` (encontrado automáticamente) · `OFFICIAL` (publicado por el club/promotor) · `VERIFIED` (revisado por el staff con “Mark as verified”). Encontrar algo en Google o en un feed nunca lo marca como verificado.

## Calidad y revisión

Antes de publicar se comprueba: título, hora, fecha no caducada ni lejana, ubicación conocida y dentro del radio de la ciudad (`City.searchRadiusKm`), posible duplicado y si la fuente permite publicación automática. Si algo falla, va a `/admin/discovery/review`, con acciones **Approve, Edit, Merge, Reject, Delete**. Los eventos ya publicados se editan, verifican o eliminan desde `/admin/events?source=IMPORT` (incluye el historial de cambios).

## Añadir una fuente nueva

1. Si es de un tipo existente: `/admin/discovery → Nueva fuente`.
2. Si es un tipo nuevo:
   - añadir el valor a `DiscoverySourceType` en `prisma/schema.prisma` y crear la migración;
   - implementar un `Connector` en `src/server/discovery/connectors/` (`fetchEvents` y/o `fetchVenues`) usando `fetchText/fetchJson` (nunca `fetch` directo) y devolviendo `ExternalEvent` / `ExternalVenue` sin inventar campos;
   - registrarlo en `connectors/index.ts`;
   - si el proveedor limita el cacheo, definir `retentionDays`;
   - añadir tests con un fixture en `tests/fixtures/`.

## Formato de feed para partners (v1)

```json
{
  "version": 1,
  "events": [{
    "id": "abc-123",
    "title": "Saturday Night",
    "start": "2026-10-03T23:30:00+02:00",
    "end": "2026-10-04T06:00:00+02:00",
    "doors": "2026-10-03T23:00:00+02:00",
    "venue": { "name": "Club XYZ", "address": "Carrer X 1, Barcelona", "lat": 41.39, "lng": 2.19 },
    "price": { "min": 15, "max": 20, "currency": "EUR" },
    "ticketUrl": "https://…",
    "url": "https://…",
    "organizer": "XYZ Crew",
    "genres": ["techno"],
    "images": ["https://…"],
    "status": "scheduled"
  }],
  "venues": [{ "id": "club-xyz", "name": "Club XYZ", "address": "…", "lat": 41.39, "lng": 2.19, "phone": "…", "website": "https://…" }]
}
```

Las fechas sin zona horaria (`"2026-10-03T23:30"`) se interpretan en la zona de la ciudad de la fuente.

## Multi-ciudad

Las fuentes pertenecen a una `City` (zona horaria, coordenadas, `searchRadiusKm`). Para Madrid, Valencia… basta con crear fuentes con esa ciudad.
