"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/providers/toast-provider";
import { api, ApiClientError } from "@/lib/api-client";

export interface RuleValues {
  id?: string;
  name: string;
  platformFeeBps: number;
  platformFeeFixed: number;
  providerFeeBps: number;
  providerFeeFixed: number;
  taxRateBps: number;
  taxIncluded: boolean;
  feesPaidByBuyer: boolean;
  currency: string;
  isActive: boolean;
}

const EMPTY: RuleValues = { name: "", platformFeeBps: 0, platformFeeFixed: 0, providerFeeBps: 0, providerFeeFixed: 0, taxRateBps: 0, taxIncluded: true, feesPaidByBuyer: true, currency: "EUR", isActive: false };

/** % ↔ basis points and € ↔ cents conversions happen here; the API only takes integers. */
const pct = (bps: number) => String(bps / 100);
const eur = (c: number) => String(c / 100);
const toBps = (s: string) => Math.round(Number(s.replace(",", ".") || 0) * 100);
const toCents = (s: string) => Math.round(Number(s.replace(",", ".") || 0) * 100);

export function CommissionRuleForm({ rule, trigger }: { rule?: RuleValues; trigger: string }) {
  const initial = rule ?? EMPTY;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    name: initial.name,
    platformPct: pct(initial.platformFeeBps),
    platformFixed: eur(initial.platformFeeFixed),
    providerPct: pct(initial.providerFeeBps),
    providerFixed: eur(initial.providerFeeFixed),
    taxPct: pct(initial.taxRateBps),
    taxIncluded: initial.taxIncluded,
    feesPaidByBuyer: initial.feesPaidByBuyer,
    currency: initial.currency,
    isActive: initial.isActive,
  });
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: v.name,
      platformFeeBps: toBps(v.platformPct),
      platformFeeFixed: toCents(v.platformFixed),
      providerFeeBps: toBps(v.providerPct),
      providerFeeFixed: toCents(v.providerFixed),
      taxRateBps: toBps(v.taxPct),
      taxIncluded: v.taxIncluded,
      feesPaidByBuyer: v.feesPaidByBuyer,
      currency: v.currency.toUpperCase(),
      isActive: v.isActive,
    };
    try {
      if (rule?.id) await api.patch(`/api/admin/commission-rules/${rule.id}`, body);
      else await api.post("/api/admin/commission-rules", body);
      toast("Regla guardada");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast((err as ApiClientError).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const num = (key: keyof typeof v, label: string, suffix: string) => (
    <Field label={`${label} (${suffix})`}>
      <Input inputMode="decimal" value={String(v[key])} onChange={(e) => setV({ ...v, [key]: e.target.value.replace(/[^\d.,]/g, "") })} />
    </Field>
  );

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex h-8 items-center rounded-full bg-surface-3 px-3 text-[12px] font-bold hover:bg-line-strong">{trigger}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={rule ? "Editar regla de comisión" : "Nueva regla de comisión"} tall>
        <form onSubmit={save} className="space-y-4 pb-4">
          <Field label="Nombre"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            {num("platformPct", "Comisión ORIVEXY NIGHTS", "%")}
            {num("platformFixed", "Fijo por entrada", "€")}
            {num("providerPct", "Proveedor de pago", "%")}
            {num("providerFixed", "Fijo por pedido", "€")}
            {num("taxPct", "Impuesto", "%")}
            <Field label="Moneda"><Input value={v.currency} maxLength={3} onChange={(e) => setV({ ...v, currency: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={v.taxIncluded} onChange={(e) => setV({ ...v, taxIncluded: e.target.checked })} className="size-4 accent-[#d7ff3a]" /> Precios con impuestos incluidos</label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={v.feesPaidByBuyer} onChange={(e) => setV({ ...v, feesPaidByBuyer: e.target.checked })} className="size-4 accent-[#d7ff3a]" /> La comisión la paga el comprador</label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} className="size-4 accent-[#d7ff3a]" /> Regla activa</label>
          <p className="text-[12px] text-faint">Las reglas solo se aplican cuando la venta de entradas esté habilitada. Ningún porcentaje es definitivo hasta entonces.</p>
          <Button type="submit" loading={saving} className="w-full" size="lg">Guardar</Button>
        </form>
      </Sheet>
    </>
  );
}
