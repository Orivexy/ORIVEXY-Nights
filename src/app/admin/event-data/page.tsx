import Link from "next/link";
import { eventDataOverview } from "@/server/services/admin-data";
import { getSessionUser } from "@/server/auth/session";
import { JobCards, RunsList, SourcesTable, Stat } from "@/components/admin/sync-panels";
import { isAdmin } from "@/lib/roles";
import { timeAgo } from "@/lib/time";

export const metadata = { title: "Event Data" };

export default async function EventDataPage() {
  const [o, user] = await Promise.all([eventDataOverview(), getSessionUser()]);
  const t = o.totals;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Event Data</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Fuentes de eventos → normalización → deduplicación → eventos ORIVEXY NIGHTS → mapa, Descubrir y feed. Solo se muestran eventos vigentes o futuros.</p>
        </div>
        <Link href="/admin/discovery/review" className="inline-flex h-10 items-center rounded-full bg-volt px-5 text-sm font-bold text-on-volt">
          Revisión pendiente · {t.pendingReview}
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Eventos próximos" value={t.upcoming} hint={`${t.upcomingImported} importados`} tone="ok" />
        <Stat label="Nuevos (7 días)" value={t.created7} />
        <Stat label="Modificados (7 días)" value={t.modified7} />
        <Stat label="Caducados (7 días)" value={t.expired7} hint="Terminados: ya no se muestran" />
        <Stat label="Inactivos" value={t.inactive} hint="La fuente dejó de publicarlos" />
        <Stat label="Duplicados fusionados" value={t.mergedDuplicates} />
        <Stat label="Posibles duplicados" value={t.possibleDuplicates} tone={t.possibleDuplicates ? "warn" : undefined} hint="En revisión" />
        <Stat label="Importados sin local" value={t.withoutVenue} hint="Se vinculan al sincronizar locales" />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Sincronización</h2>
        <JobCards jobs={o.jobs} canRun={isAdmin(user?.role)} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Fuentes de eventos</h2>
        <SourcesTable sources={o.sources} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Últimos cambios</h2>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          {o.changes.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-2 p-3">
              <Link href={`/events/${c.event.slug}`} className="font-semibold">{c.event.title}</Link>
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
