# Locales, horarios, eventos y mapa

Cómo ORIVEXY NIGHTS obtiene y mantiene al día discotecas, salas, horarios, ubicaciones y eventos de Barcelona (y de cualquier ciudad que se añada), y cómo los muestra en el mapa.

```
APIs DE PLACES ─→ VENUE_SYNC ─→ normalización ─→ deduplicación ─→ BD ORIVEXY NIGHTS (Venue + horarios) ─→ mapa · perfiles · búsqueda
FUENTES EVENTOS ─→ EVENT_SYNC ─→ normalización ─→ deduplicación ─→ BD ORIVEXY NIGHTS (Event → Venue) ─→ mapa · Descubrir · feed
```

**Las páginas nunca llaman a APIs externas.** Todo lo que ve el usuario sale de la base de datos de ORIVEXY NIGHTS. Las APIs se consultan solo desde los jobs en segundo plano. Si una API está caída, sin cuota o sin clave, el job registra el error y reintenta más tarde con backoff, y la app sigue mostrando los datos guardados.

## API keys: qué necesita ORIVEXY NIGHTS y dónde se configuran

Todas son variables de entorno **del servidor** (`.env` en local, o variables del hosting en producción). Ninguna lleva el prefijo `NEXT_PUBLIC_`, ninguna llega al navegador y no se suben a GitHub (`.env` está en `.gitignore`; `.env.example` solo tiene valores vacíos).

| Variable | ¿Obligatoria? | Para qué | Dónde se consigue |
| --- | --- | --- | --- |
| — (OpenStreetMap) | No hace falta clave | Descubrir locales, dirección, teléfono, web y horarios | — |
| `GOOGLE_PLACES_API_KEY` | Opcional | Vincular locales con su place ID de Google y detectar cierres definitivos | Google Cloud Console → activar **Places API (New)** → Credenciales → clave restringida a esa API y a la IP del servidor |
| `TICKETMASTER_API_KEY` | Opcional | Conciertos y eventos con entradas | developer.ticketmaster.com (clave gratuita) |
| `MAPBOX_TOKEN` / `MAPTILER_KEY` | Opcional | Teselas del mapa de Mapbox/MapTiler en lugar de CARTO | Cuenta del proveedor; se sirven por `/api/map/tiles`, el token no sale del servidor |
| `CRON_SECRET` | Sí si usas cron externo | Proteger `/api/cron/*` | Cualquier cadena aleatoria larga |

Límites y costes (también en `.env.example`): `OVERPASS_DAILY_LIMIT` (200), `GOOGLE_PLACES_DAILY_LIMIT` (150), `TICKETMASTER_DAILY_LIMIT` (1000) y `GOOGLE_PLACES_COST_PER_1000` (opcional, solo para estimar el coste en el admin).

## Proveedores de lugares (`src/server/places`)

`PlaceProvider` es la única interfaz que conoce ORIVEXY NIGHTS (`types.ts`): `discover(área, categorías)`, `refresh(ids)` y una **política de uso** con las condiciones del proveedor. Para cambiar o añadir un proveedor (Foursquare, un partner, etc.) basta con implementar la interfaz, registrarla en `places/index.ts` y crear su conector en `discovery/connectors`. El resto de ORIVEXY NIGHTS no cambia.

### OpenStreetMap (Overpass API): fuente principal

- Datos © OpenStreetMap contributors, licencia **ODbL**: se pueden guardar y mostrar en cualquier mapa, siempre con atribución. ORIVEXY NIGHTS la muestra en el perfil del local, en la tarjeta del mapa y en el propio mapa.
- Busca `amenity=nightclub`, `leisure=dance`, `amenity=music_venue`, bares con `live_music=yes` y `amenity=events_venue` alrededor del centro de la ciudad (`radiusKm`).
- Guarda: nombre, dirección (solo de las etiquetas `addr:*`; si no hay calle queda **vacía** y se muestra “Dirección no disponible”), barrio, coordenadas, teléfono, web, Instagram, categorías, horarios (`opening_hours`) y el id del objeto OSM como `sourceUrl`.
- OSM no tiene valoraciones ni fotos: quedan vacías. La valoración que ve el usuario es siempre la de las reseñas de ORIVEXY NIGHTS.
- Uso justo de la instancia pública: unas 10 000 peticiones y 1 GB al día. ORIVEXY NIGHTS hace muy pocas, con un tope configurable.
- Si la instancia principal está saturada (429/504), se prueba cada espejo público de `OVERPASS_MIRRORS`, en orden.

### Google Places API (New): solo para vincular

Se evaluó como fuente principal, pero **sus condiciones no lo permiten**:

- Solo el **place ID** se puede guardar indefinidamente. La latitud/longitud, como máximo 30 días. El resto (nombre, dirección, horarios, valoración, fotos…) no se puede guardar.
- El contenido de Places **no se puede mostrar sobre un mapa que no sea de Google**, y el mapa de ORIVEXY NIGHTS no lo es.

Por eso, ORIVEXY NIGHTS usa Google solo para:

- añadir el `googlePlaceId` a locales que ya existen;
- detectar cierres definitivos (`CLOSED_PERMANENTLY`).

El nombre se compara en memoria y se descarta. Las coordenadas del registro caducan a los 30 días (`purgeExpiredSourceData`). Un lugar de Google sin equivalente en ORIVEXY NIGHTS queda en revisión con un enlace a Google Maps, y el admin no permite crearlo con datos de Google.

La máscara de campos (`id, displayName, location, businessStatus`) se factura como *Text Search Pro*. Valoración y horarios serían *Enterprise*, y no se piden. No se hace scraping de Google en ningún caso.

Si en el futuro se quiere mostrar contenido de Google (valoraciones, fotos), habrá que añadir un renderer de Google Maps (ver *Mapa*) y pedir esos datos en vivo, sin guardarlos.

## Jobs (`src/server/sync/jobs.ts`)

| Job | Qué hace | Frecuencia por defecto |
| --- | --- | --- |
| `VENUE_SYNC` | Descubre locales nuevos, actualiza datos, dirección y coordenadas, vincula place IDs, detecta cierres y vincula eventos huérfanos con su local | `VENUE_SYNC_INTERVAL` = 24 h |
| `EVENT_SYNC` | Sincroniza las fuentes de eventos (iCal, schema.org, feeds de partners, Ticketmaster) | `EVENT_SYNC_INTERVAL` = 30 min |
| `VENUE_HOURS_SYNC` | Relee por id solo los horarios de los locales ya conocidos (1 petición por cada 300 locales) | `VENUE_HOURS_SYNC_INTERVAL` = 12 h |

Cada job tiene:

- frecuencia configurable (en `.env`, o por job desde el admin);
- un *lease* en BD, para que nunca corra dos veces a la vez;
- un registro por ejecución (`SyncRun`);
- último éxito y último fallo, con el error;
- reintento con **backoff exponencial**: 30 min, 1 h, 2 h… hasta el intervalo (mínimo 6 h). Nunca entra en bucle.

Cada fuente tiene además su propio calendario y su propio backoff. Se ejecutan dentro del proceso (`ENABLE_INPROCESS_JOBS=true`, que comprueba cada minuto si toca) o desde un cron externo:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/venue-sync
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/event-sync
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/venue-hours-sync
```

### Reglas de actualización

- **Quién puede sobrescribir.** La fuente principal de un local (la que lo creó), o la fuente oficial del propio local, puede cambiar cualquier campo. Las demás fuentes solo rellenan huecos. Los locales de la comunidad nunca se sobrescriben.
- **Historial.** Cada cambio queda en `VenueChange` (campo, antes, después, fuente, fecha) y en `Venue.fieldUpdatedAt` (fecha por campo). Además se guardan `lastSyncedAt`, `lastVerifiedAt`, `nextSyncAt`, `hoursUpdatedAt` y `hoursSource`.
- **Cierres.** Un local importado se desactiva si la fuente lo marca como cerrado, o si desaparece en **dos** sincronizaciones completas seguidas. Nunca se desactiva nada si la respuesta viene vacía o con menos de la mitad de resultados que la vez anterior. Si vuelve a aparecer, se reactiva. Los locales oficiales o verificados solo reciben un aviso en *Map Data*.
- **Confianza.** Lo importado es `IMPORTED`. Solo el staff marca algo como `VERIFIED`: una API nunca lo hace.

## Horarios (`src/lib/hours.ts`)

Formato: `{ fri: [{ open: "23:00", close: "06:00" }] }`. Si el cierre no es posterior a la apertura, el tramo termina al día siguiente. En el ejemplo, el viernes a las 23:00 abre y sigue abierto hasta el sábado a las 06:00. `"00:00"–"00:00"` equivale a 24 horas.

`openingStatus()` calcula el estado a partir del horario semanal, la hora actual y la zona del local (`Europe/Madrid`), sin depender de ningún campo estático de la API. Devuelve:

- 🟢 **Abierto ahora** · “Cierra a las 06:00”;
- ⚪ **Cerrado** · “Abre hoy a las 23:30” / “Abre mañana…” / “Abre el viernes…”;
- la línea de hoy: “Hoy abierto hasta las 06:00”, “Hoy de 23:30 a 06:00”, “Hoy ya ha cerrado”.

Se trabaja con fechas locales concretas, así que los cambios de hora se calculan bien. La noche del cambio de octubre dura una hora más y la de marzo, una menos. Hay tests para medianoche, domingo → lunes, zonas distintas y DST.

`parseOsmOpeningHours()` entiende lo habitual: `Mo-Fr`, listas, rangos que dan la vuelta como `Fr-Mo`, `26:00`, `24:00`, `off`, `24/7` y `PH off`. Si encuentra algo que no entiende del todo (meses, fechas, `sunset`, `+`, comentarios…) devuelve `null`: un horario nunca se inventa.

## Eventos

- Solo se muestran eventos **vigentes o futuros**: sin fin, cuentan como en curso durante 6 horas. En Inicio el orden es **Hoy → Mañana → Próximos 7 días → Próximas semanas**. Una noche va de 06:00 a 06:00.
- Cada evento guarda fecha, hora, lugar/local, coordenadas, precio (si falta: **“Precio no disponible”**), enlace de entradas o información, fuente (`primarySource`, `sourceUrl`, `SourceEventRecord.externalId`), `lastSyncedAt` y `lastVerifiedAt`.
- **Evento → local.** El vínculo se hace al importar (nombre del lugar + coordenadas) y de nuevo tras cada `VENUE_SYNC` (`linkEventsToVenues`). Así, en el perfil de Razzmatazz aparecen sus próximos eventos, sea cual sea la fuente.

## Mapa (`src/components/map`)

- **MapProvider.** `types.ts` define el contrato (`MapProviderProps`) y `map-view.tsx` elige el renderer según `MapConfig.renderer`.
  - **MapLibre GL** (por defecto, `MAP_PROVIDER=openfreemap`): mapa vectorial fluido estilo Apple Maps (zoom continuo, rotación, inclinación y edificios 3D, botón 2D/3D). Teselas de OpenFreeMap (gratis, sin clave ni límites) con el estilo `liberty` recoloreado de noche en `night-style.ts`. Sin WebGL, o si el estilo no carga, cae a Leaflet automáticamente.
  - **Satélite**: botón en el mapa (vista híbrida: ortofoto + nombres de calles). Ortofoto oficial de Catalunya del ICGC (CC BY 4.0, sin clave; `MAP_SATELLITE_URL`, vacío para desactivarla).
  - **Leaflet** (`providers/leaflet-map.tsx`): teselas raster de CARTO (sin clave), Mapbox o MapTiler (los tokens pasan por el servidor). Para añadir Mapbox GL o Google Maps se crea `providers/<nombre>-map.tsx` y se registra. Nada más de la app importa librerías de mapas.
- **Clustering.** `clusters.ts` usa `supercluster`, independiente del proveedor. Muestra burbujas con el número (“24”) que se abren al hacer zoom. El marcador seleccionado nunca queda escondido en un grupo.
- **Marcadores propios.**
  - Locales: círculo con ecualizador, verde neón si está abierto ahora.
  - Eventos: insignia con el icono de su tipo (fiesta, FM, festival, concierto, DJ).
  - Lo que está pasando ahora late. La ubicación del usuario se muestra con un halo.
- **Filtros.** Hoy · Mañana · Este finde · 7 días; precio (Gratis, < 10 €, 10–20 €, 20–30 €, 30 €+); tipo (Discoteca, Fiesta, Festival, Concierto, Evento); género; “Abierto ahora”; “Más cerca primero”.
  - Un precio desconocido nunca cuenta como gratis ni entra en un tramo.
  - Lista y mapa salen del mismo cálculo (`lib/map-filters.ts`), así que siempre coinciden.
- **Búsqueda.** El buscador del mapa y la búsqueda global entienden intenciones (`lib/search-intent.ts`): “fiesta hoy”, “techno”, “clubs cerca de mí”, “gratis este finde”, “Barcelona” o el nombre de un local.
- **Ubicación.** Solo se pide cuando el usuario pulsa “mi ubicación”, activa “Más cerca primero” o busca “cerca de mí”. Es aproximada (sin alta precisión) y se guarda en la sesión del navegador. Sirve para las distancias (“450 m”, “1,2 km”) y para ordenar por cercanía.
- **Cómo llegar.** Abre la app de mapas del dispositivo: Apple Maps en iPhone/Mac, `geo:` en Android y Google Maps en la web. ORIVEXY NIGHTS no hace navegación propia.
- **Tarjeta inferior.** Imagen, nombre, valoración ORIVEXY NIGHTS, distancia, estado (abierto/cierra/abre), géneros, próximo evento con precio, y los botones Ver perfil, Cómo llegar y Eventos, además de la atribución de la fuente.

## Admin

- **`/admin/map-data`**:
  - totales de locales (activos, nuevos, actualizados, inactivos, con horario, sin dirección) y reparto por confianza;
  - estado de `VENUE_SYNC` y `VENUE_HOURS_SYNC`, con botones Ejecutar ahora y Activar/Desactivar;
  - fuentes de lugares, avisos de cierre y últimos cambios;
  - uso de APIs de los últimos 30 días: peticiones de hoy frente al límite, errores y coste estimado si hay tarifa configurada. La facturación real está en la consola de cada proveedor.
- **`/admin/event-data`**: eventos próximos, nuevos, modificados, caducados, inactivos, duplicados (fusionados y posibles), importados sin local; estado de `EVENT_SYNC` y fuentes.
- La configuración de fuentes sigue en `/admin/discovery`, con la cola de revisión.

## Añadir otra ciudad

1. Añade la ciudad (`src/config/cities.ts` o fila en `City`), con su `timezone`, centro y `searchRadiusKm`.
2. En `/admin/discovery`, crea una fuente **OpenStreetMap · Overpass** para esa ciudad, activada y con publicación automática.
3. Crea también las fuentes de eventos que tengas para ella.

`VENUE_SYNC` la incluirá en su siguiente pasada.

## Otras fuentes de eventos de Barcelona

El catálogo Open Data BCN del Ayuntamiento publica agendas de actividades con licencia CC BY 4.0. Es un buen candidato para un conector oficial, pero no se ha podido verificar su formato actual desde el entorno de desarrollo, así que no se ha implementado a ciegas. Para integrarlo:

1. Descarga el recurso JSON del dataset.
2. Escribe un parser con fixture y tests, como `connectors/ticketmaster.ts`.
3. Muestra la atribución “Ajuntament de Barcelona” en los eventos.

## Búsqueda de direcciones (Nominatim)

Al crear un evento o corregir la ubicación de un local se puede buscar una dirección: `/api/geocode` (solo con sesión) consulta [Nominatim](https://nominatim.openstreetmap.org) de OpenStreetMap, sin clave. Se respeta su política de uso: una petición por segundo para todo el servidor, User-Agent propio, búsqueda solo al pulsar (no mientras se escribe), caché de 24 h y límite diario (`NOMINATIM_DAILY_LIMIT`, visible en *Map Data*). Si no responde, el formulario lo dice y se puede marcar el punto en el mapa. `NOMINATIM_URL` permite usar una instancia propia.

## Fuentes con clave

Cada ciudad tiene sus fuentes de Ticketmaster y Google Places activadas pero **en espera**: no se ejecutan ni cuentan como error hasta que existe su clave (`TICKETMASTER_API_KEY`, `GOOGLE_PLACES_API_KEY`, o el menú *Claves de API…* de la app de escritorio). En `/admin/discovery` aparecen como «ESPERANDO CLAVE».
