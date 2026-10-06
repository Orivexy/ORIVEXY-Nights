import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { ApiError, badRequest, forbidden, notFound } from "../errors";
import type { SessionUser } from "../auth/session";
import { isAdmin } from "@/lib/roles";
import { assertFeature } from "./flags";
import { calculateOrder } from "./fees";
import { resolveCommissionRule } from "./commission";
import { getPaymentProvider } from "./payments";

const ORDER_TTL_MS = 15 * 60_000;

export interface CreateOrderInput {
  eventId: string;
  items: Array<{ ticketTypeId: string; quantity: number }>;
  idempotencyKey?: string;
}

/**
 * Creates an order for platform-sold tickets. Prices, fees, currency and owner
 * are all derived on the server from the database — the client only sends
 * ticket type ids and quantities. Disabled while TICKETS_ENABLED is false.
 */
export async function createOrder(user: SessionUser & { email: string }, input: CreateOrderInput) {
  assertFeature("tickets");

  if (input.idempotencyKey) {
    const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) throw forbidden();
      return existing;
    }
  }

  const now = new Date();
  const event = await db.event.findUnique({
    where: { id: input.eventId },
    select: { id: true, title: true, status: true, ticketProvider: true, salesStatus: true, salesStartAt: true, salesEndAt: true, businessId: true },
  });
  if (!event || event.status !== "PUBLISHED") throw notFound("Evento no encontrado");
  if (event.ticketProvider !== "PLATFORM" || event.salesStatus !== "ON_SALE") throw badRequest("Este evento no vende entradas en ORIVEXY NIGHTS");
  if ((event.salesStartAt && event.salesStartAt > now) || (event.salesEndAt && event.salesEndAt < now)) throw badRequest("La venta no está abierta");

  const ids = [...new Set(input.items.map((i) => i.ticketTypeId))];
  if (ids.length !== input.items.length) throw badRequest("Tipos de entrada repetidos");
  const types = await db.ticketType.findMany({ where: { id: { in: ids }, eventId: event.id, status: "ACTIVE" } });
  if (types.length !== ids.length) throw badRequest("Tipo de entrada no válido");
  const currencies = new Set(types.map((t) => t.currency));
  if (currencies.size !== 1) throw badRequest("Monedas mezcladas en el pedido");

  const lines = input.items.map((item) => {
    const t = types.find((x) => x.id === item.ticketTypeId)!;
    if (item.quantity < 1 || item.quantity > t.maxPerOrder) throw badRequest(`Cantidad no válida para ${t.name}`);
    if ((t.salesStartAt && t.salesStartAt > now) || (t.salesEndAt && t.salesEndAt < now)) throw badRequest(`${t.name} no está a la venta`);
    return { type: t, quantity: item.quantity, unitPrice: t.priceCents };
  });

  const rule = await resolveCommissionRule(event.businessId, now);
  const amounts = calculateOrder(lines, rule);
  const currency = [...currencies][0]!;

  const order = await db.$transaction(async (tx) => {
    // Reserve capacity atomically (no overselling under concurrency).
    for (const l of lines) {
      if (l.type.capacity != null) {
        const { count } = await tx.ticketType.updateMany({
          where: { id: l.type.id, soldCount: { lte: l.type.capacity - l.quantity } },
          data: { soldCount: { increment: l.quantity } },
        });
        if (!count) throw new ApiError(409, `${l.type.name}: no quedan entradas suficientes`, "SOLD_OUT");
      } else {
        await tx.ticketType.update({ where: { id: l.type.id }, data: { soldCount: { increment: l.quantity } } });
      }
    }
    return tx.order.create({
      data: {
        number: `NVX-${now.getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
        userId: user.id,
        eventId: event.id,
        currency,
        ...amounts,
        commissionRuleId: rule.id,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
        items: { create: lines.map((l) => ({ ticketTypeId: l.type.id, quantity: l.quantity, unitPrice: l.unitPrice, total: l.unitPrice * l.quantity })) },
      },
    });
  });

  const provider = getPaymentProvider();
  const checkout = await provider.createCheckout({
    orderId: order.id,
    amount: order.total,
    currency,
    description: event.title,
    customerEmail: user.email,
  });
  await db.payment.create({
    data: { orderId: order.id, provider: provider.id, providerPaymentId: checkout.providerPaymentId, amount: order.total, currency },
  });
  return { ...order, checkoutUrl: checkout.redirectUrl };
}

const orderSelect = {
  id: true,
  number: true,
  status: true,
  currency: true,
  subtotal: true,
  platformFee: true,
  tax: true,
  total: true,
  createdAt: true,
  paidAt: true,
  event: { select: { slug: true, title: true, startsAt: true } },
  items: { select: { quantity: true, unitPrice: true, total: true, ticketType: { select: { name: true } } } },
  tickets: { select: { code: true, status: true } },
} as const;

/** A user's own orders only (IDOR-safe: filtered by the session user id). */
export function listMyOrders(userId: string) {
  return db.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: orderSelect, take: 50 });
}

/** Single order; only its buyer or an admin may read it. */
export async function getOrder(viewer: SessionUser, orderId: string) {
  // Ownership is part of the query; same 404 for "missing" and "not yours" so ids can't be probed.
  const order = await db.order.findFirst({
    where: { id: orderId, ...(isAdmin(viewer.role) ? {} : { userId: viewer.id }) },
    select: orderSelect,
  });
  if (!order) throw notFound("Pedido no encontrado");
  return order;
}
