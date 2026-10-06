import "server-only";
import { db } from "../db";
import { badRequest, notFound } from "../errors";
import { assertFeature, isFeatureEnabled } from "./flags";
import { getPaymentProvider, type ProviderEvent } from "./payments";

/**
 * Refund lifecycle: REQUESTED → (provider accepts) PENDING → SUCCEEDED / FAILED.
 * SUCCEEDED is set exclusively by applyProviderEvent() after a verified
 * provider webhook. There is deliberately no function to "mark as refunded".
 */
export async function requestRefund(actorId: string, orderId: string, amount: number | null, reason?: string) {
  assertFeature("tickets");
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: { where: { status: "PAID" } }, refunds: { where: { status: { in: ["REQUESTED", "PENDING", "SUCCEEDED"] } } } },
  });
  if (!order) throw notFound("Pedido no encontrado");
  const payment = order.payments[0];
  if (!payment?.providerPaymentId) throw badRequest("El pedido no tiene un pago confirmado");
  const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount, 0);
  const refundable = payment.amount - alreadyRefunded;
  const value = amount ?? refundable;
  if (!Number.isInteger(value) || value <= 0 || value > refundable) throw badRequest("Importe de reembolso no válido");

  const refund = await db.refund.create({
    data: { orderId, paymentId: payment.id, amount: value, currency: payment.currency, reason, requestedById: actorId },
  });
  const { providerRefundId } = await getPaymentProvider().refund({ providerPaymentId: payment.providerPaymentId, amount: value, reason });
  return db.refund.update({ where: { id: refund.id }, data: { providerRefundId, status: "PENDING" } });
}

/**
 * Hook for event cancellations: requests full refunds for paid orders.
 * No-op while ticketing is disabled (there are no ORIVEXY NIGHTS orders).
 */
export async function onEventCancelled(eventId: string, actorId: string) {
  if (!isFeatureEnabled("tickets")) return { requested: 0 };
  const orders = await db.order.findMany({ where: { eventId, status: "PAID" }, select: { id: true } });
  for (const o of orders) await requestRefund(actorId, o.id, null, "Evento cancelado");
  return { requested: orders.length };
}

/** Applies a VERIFIED provider event (called only from the webhook route). */
export async function applyProviderEvent(event: ProviderEvent) {
  await db.$transaction(async (tx) => {
    if (event.type === "payment.succeeded" || event.type === "payment.failed") {
      const payment = await tx.payment.findUnique({ where: { providerPaymentId: event.providerPaymentId }, include: { order: { include: { event: { select: { businessId: true } } } } } });
      if (!payment || payment.status !== "PENDING") return; // idempotent
      if (event.type === "payment.failed") {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: event.failureReason } });
        return;
      }
      await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      await tx.order.update({ where: { id: payment.orderId }, data: { status: "PAID", paidAt: new Date() } });
      const o = payment.order;
      await tx.transaction.createMany({
        data: [
          { type: "CHARGE", amount: o.total, currency: o.currency, orderId: o.id, paymentId: payment.id, businessId: o.event.businessId, providerReference: event.providerPaymentId },
          { type: "PLATFORM_FEE", amount: o.platformFee, currency: o.currency, orderId: o.id, paymentId: payment.id, businessId: o.event.businessId },
          { type: "PROVIDER_FEE", amount: o.providerFee, currency: o.currency, orderId: o.id, paymentId: payment.id, businessId: o.event.businessId },
        ],
      });
      return;
    }
    const refund = await tx.refund.findUnique({ where: { providerRefundId: event.providerRefundId }, include: { order: { include: { event: { select: { businessId: true } } } }, payment: true } });
    if (!refund || refund.status !== "PENDING") return;
    if (event.type === "refund.failed") {
      await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED", resolvedAt: new Date() } });
      return;
    }
    await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", resolvedAt: new Date() } });
    const refunded = await tx.refund.aggregate({ where: { orderId: refund.orderId, status: "SUCCEEDED" }, _sum: { amount: true } });
    const full = (refunded._sum.amount ?? 0) >= refund.order.total;
    await tx.order.update({ where: { id: refund.orderId }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    if (full && refund.paymentId) await tx.payment.update({ where: { id: refund.paymentId }, data: { status: "REFUNDED" } });
    if (full) await tx.ticket.updateMany({ where: { orderId: refund.orderId }, data: { status: "REFUNDED" } });
    await tx.transaction.create({
      data: { type: "REFUND", amount: -refund.amount, currency: refund.currency, orderId: refund.orderId, refundId: refund.id, paymentId: refund.paymentId, businessId: refund.order.event.businessId, providerReference: event.providerRefundId },
    });
  });
}
