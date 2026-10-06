<div align="center">

<img src="public/icons/icon-512.png" alt="ORIVEXY NIGHTS" width="140" />

# ORIVEXY NIGHTS

**Qué pasa esta noche en Barcelona: discotecas, clubs, conciertos y festivales.**

<a href="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/ORIVEXY-NIGHTS-Windows.exe"><img src="https://img.shields.io/badge/Windows-Descargar-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Descargar para Windows" height="48" /></a>
&nbsp;
<a href="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/ORIVEXY-NIGHTS-Mac.dmg"><img src="https://img.shields.io/badge/Mac-Descargar-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Descargar para Mac" height="48" /></a>
&nbsp;
<a href="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/ORIVEXY-NIGHTS-Linux.AppImage"><img src="https://img.shields.io/badge/Linux-Descargar-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Descargar para Linux" height="48" /></a>

Descárgala, ábrela y listo. Gratis.

<br />

<img src="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/screenshot-home.png" alt="Inicio de ORIVEXY NIGHTS" width="880" />

<br /><br />

<img src="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/screenshot-map.png" alt="Mapa de discotecas de Barcelona" width="436" />
&nbsp;
<img src="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/screenshot-satellite.png" alt="Vista satélite" width="436" />

<img src="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/screenshot-events.png" alt="Agenda de fiestas" width="436" />
&nbsp;
<img src="https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/screenshot-event.png" alt="Evento con precio y entradas" width="436" />

</div>

## Qué tiene

- ✅ **Locales verificados uno a uno**: discotecas, clubs, salas de conciertos y espacios de festivales de Barcelona, con fotos de su web oficial.
- 🧠 **Zonas de cada local** (pista, cabina del DJ, zona VIP, barra, terraza…) detectadas en sus fotos por una pequeña red neuronal.
- 🗺️ **Mapa de Barcelona** en 3D y en vista satélite.
- 🎉 **Agenda**: fiestas, conciertos, sesiones DJ y festivales, con foto, hora, lugar y precio.
- 🔎 **Filtros**: discotecas, clubs, conciertos, fiestas, festivales, eventos, por zona y por nombre.
- 🎟️ **Comprar entradas** en un clic, cuando el evento las vende.
- 🕐 **Horarios** de cada discoteca: abierto ahora o a qué hora abre.
- 📸 **Comunidad**: fotos y vídeos de la noche, sigue a gente y a locales.
- 🔄 **Siempre al día**: la información se actualiza sola cada día.

## Cómo abrirla la primera vez

- **Windows**: abre el archivo descargado. Si sale un aviso azul, pulsa *Más información* → *Ejecutar de todas formas*.
- **Mac**: abre el archivo, arrastra ORIVEXY NIGHTS a *Aplicaciones*. La primera vez: clic derecho sobre la app → *Abrir*.
- **Linux**: clic derecho sobre el archivo → *Propiedades* → *Permitir ejecutar*, y doble clic.
- **Móvil**: con la app abierta en el ordenador, menú *ORIVEXY NIGHTS* → *Abrir en el móvil* y escanea el código.

## Para desarrolladores

**Stack**: Next.js 16 (App Router, React 19) · TypeScript · PostgreSQL + Prisma 6 · Tailwind 4 · MapLibre GL · Vitest + Playwright · Electron (apps de escritorio con PostgreSQL embebido).

**Arquitectura**: `City → Venues → Events` (ciudades en `src/config/cities.ts`, sin Barcelona fija en el código) · API REST en `src/app/api` con validación zod, sesión en servidor, roles (`USER`, `ORGANIZER`, `VENUE`, `MODERATOR`, `ADMIN`) y rate limit · servicios en `src/server/services` · fuentes de eventos `fuente → normalizar → validar → deduplicar → base de datos` en `src/server/discovery` (cada evento guarda su origen) · artistas, borradores y moderación, recomendaciones explicables, métricas internas sin datos personales.

```bash
cp .env.example .env       # DATABASE_URL y, si quieres, ADMIN_EMAIL/ADMIN_PASSWORD
npm install
npm run db:deploy && npm run db:seed
npm run dev                # http://localhost:3000
npm run typecheck && npm run lint && npm test   # comprobaciones
npm run build && npm run test:e2e               # e2e con base de datos aislada
```

Guías: [desarrollo](docs/development.md) · [despliegue](docs/deployment.md) · [fuentes de eventos](docs/event-discovery.md) · [mapa y locales](docs/places-and-map.md) · [escritorio](docs/desktop.md) · [estado del proyecto](PROJECT_STATUS.md).

<div align="center"><sub>Información y fotos de la web oficial de cada local, ubicaciones © colaboradores de OpenStreetMap, agenda de Xceed y ortofoto del ICGC.</sub></div>
