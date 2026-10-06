import "server-only";
import { ApiError } from "../errors";
import { assertFeature } from "./flags";

/**
 * Invoicing provider abstraction (e.g. a certified e-invoicing service).
 * Invoices stay DRAFT with no number until a provider issues them; ORIVEXY NIGHTS
 * never generates legal invoice numbers by itself.
 */
export interface InvoicingProvider {
  id: string;
  issue(invoiceId: string): Promise<{ number: string; providerInvoiceId: string }>;
}

export function getInvoicingProvider(): InvoicingProvider {
  assertFeature("invoicing");
  throw new ApiError(503, "No hay proveedor de facturación configurado.", "INVOICING_NOT_CONFIGURED");
}
