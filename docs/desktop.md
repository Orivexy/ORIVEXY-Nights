# Apps de escritorio (Windows, macOS, Linux) y móvil

## Windows — `ORIVEXY-NIGHTS-Windows.exe`

Instalador NSIS autocontenido (Electron + PostgreSQL embebido + runtime de Visual C++ + ffmpeg + servidor Next.js + esquema y datos base). No hace falta instalar nada más.

**Descarga:** botones al principio del README (última versión) o pestaña *Releases*. El workflow [`desktop.yml`](../.github/workflows/desktop.yml) genera y publica el `.exe` en cada push a `main` (prerelease) o al crear un tag `v*` (release).

- Se instala en `C:\Program Files\ORIVEXY NIGHTS` (pide permiso de administrador): PostgreSQL para Windows no admite rutas con acentos.
- Primera ejecución: crea la base de datos en `%APPDATA%\ORIVEXY NIGHTS\data` (o en `%ProgramData%\ORIVEXY-NIGHTS\…` si el nombre de usuario tiene acentos), aplica las migraciones y carga los datos base (ciudades, categorías, géneros, fuentes). En cada actualización aplica solo las migraciones nuevas, sin tocar tus datos.
- No incluye contenido inventado. **La primera cuenta que registres es la de administrador.**
- Con conexión a Internet, la sincronización descarga el listado verificado de locales de Barcelona (ubicación de OpenStreetMap, fotos y datos de la web oficial de cada local) en el primer minuto; los eventos llegan de las fuentes que configures en *Admin → Event Discovery* y de lo que publiquéis.
- Arranque rápido:
  - PostgreSQL y el servidor arrancan en paralelo.
  - `initdb --no-sync` y `synchronous_commit=off`.
  - Caché de compilación de Node (`NODE_COMPILE_CACHE`).
  - Precalentado de Inicio, Mapa y Descubrir.
  - Medido en Linux: primer arranque ~1,4 s, siguientes ~0,6 s hasta el servidor listo.
- Cerrar la ventana deja ORIVEXY NIGHTS en la **bandeja del sistema**: volver a abrirlo es instantáneo. Para cerrarlo del todo: clic derecho en el icono de la bandeja → **Salir**.
- Menú **ORIVEXY NIGHTS → Iniciar con Windows** arranca ORIVEXY NIGHTS oculto al encender el PC, para que esté listo al abrirlo.
- Menú **ORIVEXY NIGHTS → Claves de API…**: claves opcionales (Ticketmaster, Google Places, estilo de mapa MapTiler/Mapbox, SMTP para recuperar contraseña). Se guardan solo en ese ordenador (`api-keys.json` en la carpeta de datos), llegan al servidor como variables de entorno y nunca al navegador. Al guardar, la app se reinicia y las fuentes que esperaban esa clave empiezan solas.
- Menú **ORIVEXY NIGHTS → Borrar datos locales…** elimina la base de datos y los archivos de este ordenador y vuelve a empezar.
- Sin SMTP configurado, la recuperación de contraseña indica que no está disponible: cambia la contraseña desde *Ajustes* mientras tengas sesión.
- El `.exe` no está firmado: SmartScreen muestra "Windows protegió su PC" → *Más información* → *Ejecutar de todas formas*.
- Log: `registro.log` en la carpeta de datos (menú **ORIVEXY NIGHTS → Ver carpeta de datos**).

## macOS y Linux

- **macOS** (`ORIVEXY-NIGHTS-Mac.dmg`, Apple Silicon): arrastra la app a *Aplicaciones*. No está firmada ni notarizada por Apple: la primera vez, clic derecho → *Abrir* → *Abrir* (o *Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente*). Datos en `~/Library/Application Support/ORIVEXY NIGHTS/data`.
- **Linux** (`ORIVEXY-NIGHTS-Linux.AppImage`, x64): `chmod +x` y ejecútalo. Datos en `~/.config/ORIVEXY NIGHTS/data`.
- Mismo funcionamiento que en Windows: PostgreSQL y servidor incluidos, bandeja del sistema, QR para el móvil. "Iniciar con…" existe en Windows y Mac.
- Se generan en GitHub Actions (`desktop.yml`): Windows y Linux en Ubuntu, Mac en `macos-latest`.

## Móvil (Android / iPhone)

El servidor del PC escucha en la red local (`0.0.0.0`). Con el PC y el móvil en la misma Wi‑Fi:

1. En la app de Windows: **ORIVEXY NIGHTS → Abrir en el móvil…** (Ctrl+M) muestra un QR.
2. Escanéalo con el móvil.
3. Instálala como app (PWA): Android/Chrome → *Añadir a pantalla de inicio*; iPhone/Safari → *Compartir → Añadir a inicio*.

Notas: la primera vez Windows pide permiso en el Firewall (acepta "Redes privadas"). Por HTTP en red local los navegadores móviles no permiten geolocalización; el resto funciona.

Un APK/IPA nativo requiere el SDK de Android o un Mac con cuenta de Apple; la API REST ya está preparada para una app nativa futura.

## Generar el instalador

Requisitos (Linux): Node 22, PostgreSQL local para generar los datos base, `python3` + `pip` (runtime de Visual C++ desde PyPI) y `wine64` + `wine32` (NSIS). Con `NSIS_DOCKER=1` se usa la imagen `electronuserland/builder:wine` en lugar de wine local.

```bash
bash scripts/build-desktop.sh                     # Windows → dist-desktop/ORIVEXY-NIGHTS-Windows.exe
bash scripts/build-desktop.sh --platform linux    # en Linux → ORIVEXY-NIGHTS-Linux.AppImage
bash scripts/build-desktop.sh --platform mac      # en un Mac Apple Silicon → ORIVEXY-NIGHTS-Mac.dmg
bash scripts/build-desktop.sh --resources-only --keep-host-natives   # solo recursos (pruebas en Linux)
```

### Actualizaciones automáticas

Cada compilación de la rama principal publica una versión nueva (`0.1.<número de build>`) con `latest.yml` / `latest-linux.yml`. La app instalada (Windows y Linux AppImage) usa `electron-updater` con el feed `releases/latest/download`: comprueba al arrancar y cada 30 minutos, descarga en segundo plano y ofrece «Actualizar ahora» o instala al salir (después de parar PostgreSQL). Menú *Buscar actualizaciones*. El Mac sin firma no puede actualizarse solo: el menú abre la página de descarga.

### Cuenta de administrador

En el primer arranque la app genera una cuenta de administrador propia de ese ordenador (`admin@orivexy.local` y una contraseña aleatoria), la crea y la muestra en un aviso; siempre se puede consultar en el menú *ORIVEXY NIGHTS → Credenciales de administrador…*. El dueño puede elegir su propia contraseña en *Cambiar contraseña de administrador…* (mínimo 4 caracteres; ruta local `/api/desktop/admin-password`, solo en la app de escritorio y con el secreto de la instalación). Se guarda solo en `state.json` de la carpeta de datos, nunca en el repositorio.

### Ventana estilo macOS y pantalla completa

La app de escritorio se abre a pantalla completa (F11 en Windows/Linux, Ctrl+Cmd+F en Mac o el botón verde para salir; se recuerda). La ventana imita una app de macOS: barra de título unificada con botones de ventana estilo Windows a la derecha en todos los sistemas (minimizar, maximizar, cerrar; controlan la ventana real vía `desktop/app-preload.cjs`), atrás/adelante, buscador central y barra lateral translúcida con secciones. El servidor la sirve al detectar `AppDesktop/<plataforma>` en el user-agent (`MacShell`); en el navegador la web se ve como siempre.

### Datos iniciales (mapa lleno al abrir)

CI ejecuta las sincronizaciones reales de las fuentes sin clave (OpenStreetMap y la agenda abierta de Madrid) con `scripts/record-snapshot.mts` y guarda sus respuestas en `resources/snapshot` (`--snapshot DIR`). En el primer arranque la app las importa (`/api/cron/snapshot-import`) antes de abrir la ventana, así que el mapa ya tiene discotecas y eventos aunque no haya Internet. Dos minutos después empiezan las sincronizaciones en vivo, que lo actualizan cada día. Son los datos que publicaron las fuentes el día de la compilación; no se inventa nada. Si esas fuentes fallan en CI, la app se publica igual y el mapa se llena con la primera sincronización.

Logo e iconos: `node scripts/generate-icons.mjs` genera, desde `scripts/logo.mjs`, los iconos web/PWA, el `.ico` de Windows (incrustado en `ORIVEXY NIGHTS.exe`, accesos directos e instalador) y las imágenes del asistente de instalación.

Estructura: `desktop/main.mjs` (Electron), `desktop/backend.mjs` (arranca PostgreSQL y `server.js`, ejecutable en Node puro: `node desktop/backend.mjs <resources> <data>`), `desktop/resources/server` (build *standalone* de Next).

## Cambio de nombre (antes NIVEX)

El instalador de ORIVEXY NIGHTS actualiza encima de una instalación anterior de NIVEX (mismo identificador interno `app.nivex.desktop`) y sigue usando su carpeta de datos (`%APPDATA%\NIVEX\data`), así que no se pierden cuentas, fotos ni eventos. Las instalaciones nuevas guardan los datos en `%APPDATA%\ORIVEXY NIGHTS\data`.
