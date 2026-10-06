import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

/** Records an administrative or commercial operation. Never throws. */
export async function audit(entry: {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}) {
  const data = {
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    ipAddress: entry.ip?.slice(0, 64),
  };
  try {
    await db.auditLog.create({ data });
  } catch (err) {
    // The actor deleted their own account in this request: keep the entry, without the link.
    if ((err as Prisma.PrismaClientKnownRequestError).code === "P2003" && entry.actorId) {
      try {
        await db.auditLog.create({ data: { ...data, actorId: null, targetId: data.targetId ?? entry.actorId } });
        return;
      } catch {
        /* reported below */
      }
    }
    console.error("[audit] failed to record", entry.action, err);
  }
}
