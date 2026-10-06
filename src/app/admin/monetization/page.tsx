import { requireAdminPage } from "@/server/auth/guards";
import { FLAG_DOCS, monetizationFlags } from "@/server/monetization/flags";
import { PLAN_FEATURES, PLAN_FEATURE_LABEL } from "@/server/monetization/plans";
import { commerceStats, listCommissionRules, listPaidEvents, listPlans } from "@/server/services/admin-commerce";
import { CommissionRuleForm } from "@/components/admin/commission-rule-form";
import { PlanEditor } from "@/components/admin/plan-editor";
import { formatMoney, formatPrice } from "@/lib/money";
import { formatShortDate } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata = { title: "Monetización" };

const pct = (bps: number) => `${(bps / 100).toLocaleString("es-ES")} %`;

export default async function MonetizationPage() {
  await requireAdminPage();
  const [stats, rules, plans, paidEvents] = await Promise.all([commerceStats(), listCommissionRules(), listPlans(), listPaidEvents(20)]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-2xl font-bold">Monetización</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          ORIVEXY NIGHTS funciona como plataforma gratuita. Las funciones de pago están preparadas pero desactivadas: no se cobra, no se venden entradas, no hay suscripciones ni anuncios.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Feature flags</h2>
        <p className="text-[13px] text-muted">Solo lectura. Se cambian en las variables de entorno del servidor (nunca desde el navegador) y requieren un proveedor de pagos implementado.</p>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {FLAG_DOCS.map((f) => {
            const on = f.feature === "master" ? monetizationFlags.master : monetizationFlags[f.feature];
            return (
              <div key={f.env} className="flex items-start gap-4 p-4">
                <span className={cn("mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold", on ? "bg-volt text-on-volt" : "bg-surface-3 text-muted")}>{on ? "ON" : "OFF"}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{f.label}</p>
                  <p className="text-[13px] text-muted">{f.description}</p>
                </div>
                <code className="hidden rounded bg-surface-2 px-2 py-1 text-[12px] text-muted sm:block">{f.env}</code>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Negocios", `${stats.businesses} (${stats.verified} verificados)`],
          ["Eventos de pago (info)", stats.paidEvents],
          ["Pedidos", `${stats.orders} (${stats.paid} pagados)`],
          ["Volumen", formatMoney(stats.grossCents)],
          ["Comisión ORIVEXY NIGHTS", formatMoney(stats.platformFeeCents)],
          ["Suscripciones activas", stats.activeSubs],
          ["Promociones activas", stats.activePromos],
          ["Reembolsos pendientes", stats.pendingRefunds],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] text-muted">{label}</p>
            <p className="mt-1 font-display text-xl font-bold">{String(value)}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Comisiones</h2>
          <CommissionRuleForm trigger="Nueva regla" />
        </div>
        <p className="text-[13px] text-muted">Sin una regla activa no se puede vender ninguna entrada. La regla de un negocio tiene prioridad sobre la global.</p>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.name} <span className="text-[12px] font-normal text-muted">· {r.business?.tradeName ?? "Global"}</span></p>
                <p className="text-[13px] text-muted">
                  ORIVEXY NIGHTS {pct(r.platformFeeBps)} + {formatMoney(r.platformFeeFixed, r.currency)} · Proveedor {pct(r.providerFeeBps)} + {formatMoney(r.providerFeeFixed, r.currency)} · Impuesto {pct(r.taxRateBps)} {r.taxIncluded ? "incluido" : "aparte"} · Comisión a cargo del {r.feesPaidByBuyer ? "comprador" : "organizador"}
                </p>
              </div>
              <span className={cn("text-[12px] font-bold", r.isActive ? "text-volt" : "text-faint")}>{r.isActive ? "ACTIVA" : "INACTIVA"}</span>
              <CommissionRuleForm trigger="Editar" rule={r} />
            </div>
          ))}
          {!rules.length && <p className="p-6 text-center text-sm text-muted">No hay reglas configuradas.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Planes</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="font-display font-semibold">{p.name}</p>
                <PlanEditor plan={p} />
              </div>
              <p className="text-[12px] text-faint">{p.code} · {p.isActive ? "a la venta" : "no disponible"}</p>
              <p className="text-sm">{p.priceCents == null ? "Precio sin definir" : `${formatMoney(p.priceCents, p.currency)} / ${p.interval === "year" ? "año" : "mes"}`}</p>
              <ul className="space-y-0.5 text-[13px] text-muted">
                {PLAN_FEATURES[p.code].map((f) => <li key={f}>· {PLAN_FEATURE_LABEL[f]}</li>)}
                {!PLAN_FEATURES[p.code].length && <li>· Funciones básicas</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Eventos de pago</h2>
        <p className="text-[13px] text-muted">Precio informativo y, en su caso, enlace de venta externo. Ninguno vende entradas en ORIVEXY NIGHTS.</p>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {paidEvents.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <a href={`/events/${e.slug}`} target="_blank" className="min-w-0 flex-1 truncate font-semibold hover:underline">{e.title}</a>
              <span className="text-muted">{formatShortDate(e.startsAt, "Europe/Madrid")}</span>
              <span>{formatPrice(e.priceMin, e.priceMax, e.currency ?? "EUR")}</span>
              <span className="text-[12px] text-faint">{e.ticketProvider} · {e.salesStatus}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
