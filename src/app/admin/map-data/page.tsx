import Link from "next/link";
import { mapDataOverview } from "@/server/services/admin-data";
import { getSessionUser } from "@/server/auth/session";
import { JobCards, RunsList, SourcesTable, Stat } from "@/components/admin/sync-panels";
import { isAdmin } from "@/lib/roles";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Map Data" };

const PROVIDER_LABEL: Record<string, string> = { overpass: "OpenStreetMap (Overpass)", google_places: "Google Places", ticketmaster: "Ticketmaster" };

export default async function MapDataPage() {
  const [o, user] = await Promise.all([mapDataOverview(), getSessionUser()]);
  const admin = isAdmin(user?.role);
  const t = o.totals;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Map Data</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          APIs de lugares → descubrimiento → normalización → deduplicación → base de datos ORIVEXY NIGHTS → mapa. El mapa y las páginas leen solo de la base de datos; las APIs se consultan en segundo plano.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Locales activos" value={t.active} hint={`${t.total} en total`} />
        <Stat label="Nuevos (7 días)" value={t.created7} tone={t.created7 ? "ok" : undefined} />
        <Stat label="Actualizados (7 días)" value={t.updated7} />
        <Stat label="Inactivos" value={t.inactive} hint={`${t.closed30} cerrados en 30 días`} tone={t.inactive ? "warn" : undefined} />
        <Stat label="Con horario" value={t.withHours} hint={`${t.active - t.withHours} sin horario`} />
        <Stat label="Sin dirección postal" value={t.withoutAddress} />
        <Stat label="Importados" value={o.byTrust.IMPORTED ?? 0} hint={`Oficiales ${o.byTrust.OFFICIAL ?? 0} · Verificados ${o.byTrust.VERIFIED ?? 0} · Comunidad ${o.byTrust.COMMUNITY ?? 0}`} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Sincronización</h2>
        <JobCards jobs={o.jobs} canRun={admin} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Fuentes de lugares</h2>
        <SourcesTable sources={o.sources} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Uso de APIs (30 días)</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="p-3">Proveedor</th>
                <th className="p-3">Hoy / límite diario</th>
                <th className="p-3">Peticiones</th>
                <th className="p-3">Errores</th>
                <th className="p-3">Coste estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.usage.map((u) => (
                <tr key={u.provider}>
                  <td className="p-3 font-semibold">{PROVIDER_LABEL[u.provider] ?? u.provider}</td>
                  <td className="p-3">{u.today} / {u.limitPerDay}</td>
                  <td className="p-3">{u.requests}</td>
                  <td className={u.errors ? "p-3 text-warn" : "p-3"}>{u.errors}</td>
                  <td className="p-3 text-muted">{u.estimatedCost != null ? `${u.estimatedCost.toFixed(2)} (según tu tarifa)` : u.provider === "google_places" ? "Configura GOOGLE_PLACES_COST_PER_1000" : "Sin coste"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-faint">Contadores de ORIVEXY NIGHTS. La facturación real está en la consola de cada proveedor; el nivel gratuito no se descuenta aquí.</p>
      </section>

      {o.flags.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Avisos de las fuentes</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {o.flags.map((f) => (
              <li key={f.id} className="p-3">
                {f.venue ? <Link href={`/venues/${f.venue.slug}`} className="font-semibold underline">{f.venue.name}</Link> : "—"} <span className="text-muted">· {f.source.name} · {f.reviewReasons.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Últimos cambios</h2>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          {o.changes.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-2 p-3">
              <Link href={`/venues/${c.venue.slug}`} className="font-semibold">{c.venue.name}</Link>
              <span className="font-mono text-[12px] text-volt">{c.field}</span>
              <span className="max-w-full truncate text-muted">{c.oldValue ?? "∅"} → {c.newValue ?? "∅"}</span>
              <span className="ml-auto text-[12px] text-faint">{c.source?.name ?? "staff"} · {timeAgo(c.createdAt)}</span>
            </li>
          ))}
          {!o.changes.length && <li className="p-6 text-center text-muted">Sin cambios todavía.</li>}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Ejecuciones y errores</h2>
        <RunsList runs={o.runs} />
      </section>
    </div>
  );
}
