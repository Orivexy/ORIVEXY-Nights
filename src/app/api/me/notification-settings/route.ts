import { z } from "zod";
import type { NotificationType } from "@prisma/client";
import { route, parseJson } from "@/server/http";
import { db } from "@/server/db";
import { MUTABLE_NOTIFICATIONS } from "@/config/taxonomy";

const kinds = MUTABLE_NOTIFICATIONS.map((n) => n.value) as [string, ...string[]];

/** Notification kinds the signed-in user turned off (only optional kinds can be muted). */
export const PUT = route({ auth: true, rateLimit: "interaction" }, async ({ req, user }) => {
  const { muted } = await parseJson(req, z.object({ muted: z.array(z.enum(kinds)).max(kinds.length) }));
  const updated = await db.user.update({
    where: { id: user!.id },
    data: { mutedNotifications: [...new Set(muted)] as NotificationType[] },
    select: { mutedNotifications: true },
  });
  return { muted: updated.mutedNotifications };
});
