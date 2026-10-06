import Link from "next/link";
import { adminStats } from "@/server/services/admin";
import { interactionStats } from "@/server/services/analytics";
import { formatNumber } from "@/lib/text";

export default async function AdminHome() {
  const [s, m] = await Promise.all([adminStats(), interactionStats(7)]);
  const metrics: Array<[string, number]> = [
    ["Eventos vistos", m.totals.EVENT_VIEW ?? 0],
    ["Locales vistos", m.totals.VENUE_VIEW ?? 0],
    ["Búsquedas", m.totals.SEARCH ?? 0],
    ["Eventos guardados", m.totals.SAVE ?? 0],
    ["Clics en entradas", m.totals.TICKET_CLICK ?? 0],
    ["Compartidos", m.totals.SHARE ?? 0],
  ];
  const cards = [
    { label: "Reportes abiertos", value: s.openReports, href: "/admin/reports", alert: s.openReports > 0 },
    { label: "Eventos pendientes", value: s.pendingEvents, href: "/admin/events?status=PENDING", alert: s.pendingEvents > 0 },
    { label: "Usuarios", value: s.users, href: "/admin/users", sub: `+${s.newUsers} esta semana` },
    { label: "Suspendidos", value: s.suspended, href: "/admin/users" },
    { label: "Eventos publicados", value: s.events, href: "/admin/events" },
    { label: "Locales activos", value: s.venues, href: "/admin/venues" },
    { label: "Publicaciones", value: s.posts, href: "/admin/posts" },
  ];
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Resumen</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className={`rounded-2xl border p-4 hover:bg-surface-2 ${c.alert ? "border-warn/40 bg-warn/5" : "border-line bg-surface"}`}>
            <p className="text-[13px] text-muted">{c.label}</p>
            <p className="mt-1 font-display text-3xl font-bold">{formatNumber(c.value)}</p>
            {c.sub && <p className="text-[12px] text-faint">{c.sub}</p>}
          </Link>
        ))}
      </div>

      <h2 className="pt-4 font-display text-xl font-bold">Actividad · últimos {m.days} días</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] text-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{formatNumber(value)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-[13px] font-bold tracking-wider text-muted uppercase">Eventos más vistos</h3>
          {m.topEvents.length ? (
            <ol className="space-y-1.5 text-sm">
              {m.topEvents.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <Link href={`/events/${e.slug}`} className="truncate hover:underline">{e.title}</Link>
                  <span className="shrink-0 text-muted">{formatNumber(e.views)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Sin visitas registradas todavía.</p>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-[13px] font-bold tracking-wider text-muted uppercase">Búsquedas frecuentes</h3>
          {m.topSearches.length ? (
            <ol className="space-y-1.5 text-sm">
              {m.topSearches.map((q) => (
                <li key={q.query} className="flex justify-between gap-3"><span className="truncate">{q.query}</span><span className="shrink-0 text-muted">{formatNumber(q.count)}</span></li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Sin búsquedas registradas todavía.</p>
          )}
        </section>
      </div>
    </div>
  );
}
