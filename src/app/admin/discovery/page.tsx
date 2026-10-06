import { site } from "@/config/site";
import Link from "next/link";
import { discoveryOverview } from "@/server/services/admin-discovery";
import { listCities } from "@/server/services/cities";
import { getSessionUser } from "@/server/auth/session";
import { AdminAction } from "@/components/admin/admin-action";
import { SimpleForm } from "@/components/admin/simple-form";
import { isAdmin } from "@/lib/roles";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata = { title: "Event Discovery" };

const TYPE_OPTIONS = [
  { value: "ICS_FEED", label: "Calendario iCal (.ics)" },
  { value: "JSON_LD_PAGE", label: "Web oficial (schema.org)" },
  { value: "PARTNER_FEED", label: "Feed de partner (Nombre en proceso) (JSON)" },
  { value: "TICKETMASTER", label: "Ticketmaster Discovery API" },
  { value: "OSM_OVERPASS", label: "OpenStreetMap · Overpass (locales y horarios)" },
  { value: "MADRID_AGENDA", label: "Datos abiertos de Madrid (agenda de ocio)" },
  { value: "CATALONIA_AGENDA", label: "Agenda cultural de Catalunya (Generalitat, datos abiertos)" },
  { value: "BCN_MUSIC_VENUES", label: "Ayuntamiento de Barcelona · espacios de música y copas" },
  { value: "GOOGLE_PLACES", label: "Google Places (solo vincula IDs)" },
];

export default async function DiscoveryPage() {
  const [o, cities, user] = await Promise.all([discoveryOverview(), listCities(), getSessionUser()]);
  const admin = isAdmin(user?.role);
  const s = o.last24h;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Event Discovery</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Fuentes → normalización → deduplicación → validación → (Nombre en proceso). Solo APIs, feeds y datos publicados por las propias webs (respetando robots.txt). Intervalo por defecto: {o.defaultInterval}.
            {!o.engineEnabled && <span className="text-warn"> El motor está desactivado (DISCOVERY_ENABLED=false).</span>}
          </p>
        </div>
        <Link href="/admin/discovery/review" className="inline-flex h-10 items-center gap-2 rounded-full bg-volt px-5 text-sm font-bold text-on-volt">
          Revisión pendiente · {o.pendingEvents + o.pendingVenues}
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {[
          ["Fuentes activas", `${o.sources.filter((x) => x.enabled).length}/${o.sources.length}`],
          ["Encontrados (24 h)", s.found ?? 0],
          ["Nuevos (24 h)", s.created ?? 0],
          ["Actualizados (24 h)", s.updated ?? 0],
          ["Duplicados (24 h)", s.duplicates ?? 0],
          ["Errores (24 h)", s.errors ?? 0],
          ["Importados publicados", o.imported],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[12px] text-muted">{label}</p>
            <p className="mt-1 font-display text-xl font-bold">{String(value)}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Fuentes</h2>
          {admin && (
            <SimpleForm
              trigger="Nueva fuente"
              title="Nueva fuente"
              url="/api/admin/discovery/sources"
              note="Añade solo fuentes cuyo uso esté permitido (APIs con clave propia, feeds públicos o webs oficiales que publican datos estructurados)."
              fields={[
                { name: "name", label: "Nombre", required: true, placeholder: "Agenda oficial Sala X" },
                { name: "key", label: "Clave interna", required: true, placeholder: "sala-x-agenda" },
                { name: "type", label: "Tipo", type: "select", required: true, options: TYPE_OPTIONS },
                { name: "url", label: "URL", type: "url", hint: "Obligatoria para iCal, web oficial y feed de partner" },
                { name: "citySlug", label: "Ciudad", type: "select", required: true, options: cities.map((c) => ({ value: c.slug, label: c.name })), defaultValue: site.defaultCitySlug },
                { name: "venueSlug", label: "Local propietario (opcional)", placeholder: "sala-x" },
                { name: "trust", label: "Confianza", type: "select", options: [{ value: "IMPORTED", label: "IMPORTED (encontrado automáticamente)" }, { value: "OFFICIAL", label: "OFFICIAL (lo publica el propio club/promotor)" }], defaultValue: "IMPORTED" },
                { name: "syncIntervalMin", label: "Intervalo (minutos)", type: "integer", hint: "Vacío = EVENT_SYNC_INTERVAL" },
                { name: "config", label: "Configuración (JSON)", type: "json", placeholder: '{"pages": ["https://…/agenda"]}' },
                { name: "autoPublish", label: "Publicación", type: "checkbox", hint: "Publicar automáticamente lo que supere los controles de calidad" },
                { name: "allowImages", label: "Imágenes", type: "checkbox", hint: "Tengo permiso para usar las imágenes de esta fuente" },
                { name: "deactivateMissing", label: "Limpieza", type: "checkbox", hint: "Ocultar eventos que la fuente deje de listar", defaultValue: true },
                { name: "enabled", label: "Estado", type: "checkbox", hint: "Activar la sincronización automática" },
              ]}
            />
          )}
        </div>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {o.sources.map((src) => (
            <div key={src.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-semibold">
                  {src.name} <span className="text-[12px] font-normal text-muted">· {src.connectorLabel} · {src.city.name}{src.venue && ` · ${src.venue.name}`}</span>
                </p>
                {src.url && <p className="truncate text-[12px] text-faint">{src.url}</p>}
                <p className="text-[12px]">
                  <span className={cn("font-bold", !src.enabled || src.needsKey ? "text-faint" : src.status === "ERROR" ? "text-danger" : src.status === "OK" ? "text-volt" : "text-muted")}>{!src.enabled ? "DESACTIVADA" : src.needsKey ? "ESPERANDO CLAVE" : src.status}</span>
                  <span className="ml-2 text-muted">{src.trust}{src.autoPublish ? " · auto-publica" : " · revisión manual"}{src.allowImages ? " · imágenes" : ""}</span>
                  <span className="ml-2 text-muted">cada {src.intervalMin} min</span>
                  <span className="ml-2 text-muted">última: {src.lastSyncAt ? timeAgo(src.lastSyncAt) : "nunca"}</span>
                  <span className="ml-2 text-muted">{src.eventsFound} encontrados · {src._count.eventRecords} registros</span>
                </p>
                {src.needsKey && <p className="text-[12px] text-warn">Empezará sola cuando configures su clave de API (variables de entorno o, en la app de escritorio, menú (Nombre en proceso) → Claves de API…).</p>}
                {src.lastError && <p className="text-[12px] text-danger">{src.lastError}</p>}
              </div>
              {admin && (
                <div className="flex flex-wrap gap-2">
                  <AdminAction url={`/api/admin/discovery/sources/${src.id}/sync`} method="POST" tone="primary" success="Sincronización terminada">Sincronizar ahora</AdminAction>
                  <AdminAction url={`/api/admin/discovery/sources/${src.id}`} body={{ enabled: !src.enabled }} success={src.enabled ? "Desactivada" : "Activada"}>{src.enabled ? "Desactivar" : "Activar"}</AdminAction>
                  <AdminAction url={`/api/admin/discovery/sources/${src.id}`} body={{ autoPublish: !src.autoPublish }}>{src.autoPublish ? "Revisión manual" : "Auto-publicar"}</AdminAction>
                  <AdminAction url={`/api/admin/discovery/sources/${src.id}`} method="DELETE" tone="danger" confirm="¿Eliminar la fuente? Los eventos publicados se conservan." success="Fuente eliminada">Eliminar</AdminAction>
                </div>
              )}
            </div>
          ))}
          {!o.sources.length && <p className="p-8 text-center text-muted">Todavía no hay fuentes. Añade la primera con “Nueva fuente”.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Últimas sincronizaciones</h2>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          {o.recentRuns.map((r) => (
            <details key={r.id} className="group p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn("font-bold", r.status === "ERROR" ? "text-danger" : r.status === "OK" ? "text-volt" : "text-muted")}>{r.status}</span>
                <span className="font-semibold">{r.source?.name ?? r.job}</span>{r.job && r.source && <span className="text-[12px] text-faint">{r.job}</span>}
                <span className="text-muted">
                  {r.found} encontrados · {r.created} nuevos · {r.updated} actualizados · {r.duplicates} duplicados · {r.queued} en revisión · {r.skipped} omitidos · {r.deactivated} desactivados · {r.errors} errores
                </span>
                <span className="ml-auto text-[12px] text-faint">{timeAgo(r.startedAt)}</span>
              </summary>
              {r.log && <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-surface-2 p-3 text-[12px] whitespace-pre-wrap text-muted">{r.log}</pre>}
            </details>
          ))}
          {!o.recentRuns.length && <p className="p-8 text-center text-muted">Sin sincronizaciones todavía</p>}
        </div>
      </section>
    </div>
  );
}
