import "server-only";
import { z } from "zod";
import { ApiError } from "../errors";

/**
 * Monetization feature flags — server-only, read from the environment so
 * nothing can be switched on from the browser or the admin UI by mistake.
 *
 * Every feature needs BOTH the master switch (MONETIZATION_ENABLED) and its
 * own flag. Defaults: everything off. Turning a flag on is not enough to
 * charge money: a PaymentProvider must also be implemented (see payments.ts).
 */
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const raw = z
  .object({
    MONETIZATION_ENABLED: bool,
    TICKETS_ENABLED: bool,
    PREMIUM_VENUES_ENABLED: bool,
    SUBSCRIPTIONS_ENABLED: bool,
    ADS_ENABLED: bool,
    SPONSORED_CONTENT_ENABLED: bool,
    INVOICING_ENABLED: bool,
  })
  .parse(process.env);

export type MonetizationFeature = "tickets" | "premium" | "subscriptions" | "ads" | "sponsored" | "invoicing";

const master = raw.MONETIZATION_ENABLED;

export const monetizationFlags: Record<MonetizationFeature, boolean> & { master: boolean } = {
  master,
  tickets: master && raw.TICKETS_ENABLED,
  premium: master && raw.PREMIUM_VENUES_ENABLED,
  subscriptions: master && raw.SUBSCRIPTIONS_ENABLED,
  ads: master && raw.ADS_ENABLED,
  sponsored: master && raw.SPONSORED_CONTENT_ENABLED,
  invoicing: master && raw.INVOICING_ENABLED,
};

/** Documentation for the admin panel (which env var controls what). */
export const FLAG_DOCS: Array<{ feature: MonetizationFeature | "master"; env: string; label: string; description: string }> = [
  { feature: "master", env: "MONETIZATION_ENABLED", label: "Monetización (interruptor general)", description: "Sin él, ninguna función de pago se activa aunque su flag esté a true." },
  { feature: "tickets", env: "TICKETS_ENABLED", label: "Venta de entradas", description: "Tipos de entrada, pedidos, pagos y reembolsos dentro de ORIVEXY NIGHTS." },
  { feature: "premium", env: "PREMIUM_VENUES_ENABLED", label: "Perfiles premium", description: "Planes PLAN_PREMIUM / PLAN_BUSINESS para locales y organizadores." },
  { feature: "subscriptions", env: "SUBSCRIPTIONS_ENABLED", label: "Suscripciones", description: "Cobro recurrente de planes a negocios." },
  { feature: "sponsored", env: "SPONSORED_CONTENT_ENABLED", label: "Contenido patrocinado", description: "Eventos, locales y publicaciones promocionados (siempre etiquetados)." },
  { feature: "ads", env: "ADS_ENABLED", label: "Publicidad", description: "Anuncios en espacios reservados (siempre etiquetados como publicidad)." },
  { feature: "invoicing", env: "INVOICING_ENABLED", label: "Facturación", description: "Emisión de facturas mediante un proveedor externo." },
];

const DISABLED_MESSAGE: Record<MonetizationFeature, string> = {
  tickets: "La venta de entradas en ORIVEXY NIGHTS todavía no está disponible. Puedes indicar el precio y un enlace de venta externo.",
  premium: "Los planes premium todavía no están disponibles.",
  subscriptions: "Las suscripciones todavía no están disponibles.",
  ads: "La publicidad todavía no está disponible.",
  sponsored: "El contenido patrocinado todavía no está disponible.",
  invoicing: "La facturación todavía no está disponible.",
};

export function isFeatureEnabled(feature: MonetizationFeature): boolean {
  return monetizationFlags[feature];
}

/** Throws a clear 403 when a disabled feature is requested. */
export function assertFeature(feature: MonetizationFeature): void {
  if (!monetizationFlags[feature]) throw new ApiError(403, DISABLED_MESSAGE[feature], "FEATURE_DISABLED");
}
