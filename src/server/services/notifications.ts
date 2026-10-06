import "server-only";
import type { NotificationType, Prisma } from "@prisma/client";
import { db } from "../db";
import { toUserMini, userMiniSelect } from "./mappers";
import type { NotificationData, Page } from "@/lib/types";

/**
 * Delivery channels. In-app (the Notification table) is always on; push /
 * email channels can be registered here without touching call sites.
 */
export interface NotificationChannel {
  deliver(notification: { id: string; userId: string; type: NotificationType }): Promise<void>;
}
const channels: NotificationChannel[] = [];
export function registerNotificationChannel(channel: NotificationChannel) {
  channels.push(channel);
}

interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  postId?: string | null;
  eventId?: string | null;
  commentId?: string | null;
  /** Same key → notification created at most once. */
  dedupeKey?: string;
}

async function blockedPairs(inputs: NotifyInput[]) {
  const pairs = inputs.filter((i) => i.actorId).map((i) => ({ a: i.actorId!, b: i.userId }));
  if (!pairs.length) return new Set<string>();
  const rows = await db.block.findMany({
    where: { OR: pairs.flatMap(({ a, b }) => [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }]) },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.flatMap((r) => [`${r.blockerId}:${r.blockedId}`, `${r.blockedId}:${r.blockerId}`]));
}

export async function notify(input: NotifyInput) {
  if (input.actorId && input.actorId === input.userId) return; // never notify yourself
  if (input.actorId && (await blockedPairs([input])).size) return; // nor across a block
  const recipient = await db.user.findUnique({ where: { id: input.userId }, select: { mutedNotifications: true } });
  if (recipient?.mutedNotifications.includes(input.type)) return; // turned off in settings
  try {
    const n = await db.notification.create({ data: input, select: { id: true, userId: true, type: true } });
    await Promise.allSettled(channels.map((c) => c.deliver(n)));
  } catch (err) {
    // Unique violation on dedupeKey = already notified.
    if ((err as Prisma.PrismaClientKnownRequestError).code !== "P2002") throw err;
  }
}

export async function notifyMany(inputs: NotifyInput[]) {
  const candidates = inputs.filter((i) => !(i.actorId && i.actorId === i.userId));
  const blocked = await blockedPairs(candidates);
  const allowed = candidates.filter((i) => !(i.actorId && blocked.has(`${i.actorId}:${i.userId}`)));
  // Kinds each recipient turned off in settings.
  const muted = allowed.length
    ? await db.user.findMany({ where: { id: { in: [...new Set(allowed.map((i) => i.userId))] }, NOT: { mutedNotifications: { isEmpty: true } } }, select: { id: true, mutedNotifications: true } })
    : [];
  const mutedBy = new Map(muted.map((u) => [u.id, new Set(u.mutedNotifications)]));
  const rows = allowed.filter((i) => !mutedBy.get(i.userId)?.has(i.type));
  if (rows.length) await db.notification.createMany({ data: rows, skipDuplicates: true });
}

export async function listNotifications(userId: string, cursor?: string, limit = 20): Promise<Page<NotificationData>> {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      createdAt: true,
      readAt: true,
      actor: { select: userMiniSelect },
      post: {
        select: {
          id: true,
          photos: { select: { key: true }, orderBy: { position: "asc" }, take: 1 },
          video: { select: { posterKey: true } },
        },
      },
      event: { select: { slug: true, title: true, startsAt: true, coverKey: true } },
      comment: { select: { body: true } },
    },
  });
  const items = rows.slice(0, limit).map<NotificationData>((n) => ({
    id: n.id,
    type: n.type,
    createdAt: n.createdAt,
    read: Boolean(n.readAt),
    actor: n.actor ? toUserMini(n.actor) : null,
    post: n.post ? { id: n.post.id, thumbKey: n.post.photos[0]?.key ?? n.post.video?.posterKey ?? null } : null,
    event: n.event,
    comment: n.comment ? { body: n.comment.body.slice(0, 120) } : null,
  }));
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
}

export function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
