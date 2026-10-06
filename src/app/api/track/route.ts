import { z } from "zod";
import { route, parseJson } from "@/server/http";
import { db } from "@/server/db";
import { recordInteraction } from "@/server/services/analytics";

const cuid = z.string().min(10).max(40);

/** Client-side metrics: ticket link clicks and shares (ids are checked, the user comes from the session). */
export const POST = route({ rateLimit: "interaction" }, async ({ req, user }) => {
  const input = await parseJson(req, z.object({ type: z.enum(["TICKET_CLICK", "SHARE"]), eventId: cuid.optional(), venueId: cuid.optional() }).refine((v) => v.eventId || v.venueId));
  const exists = input.eventId
    ? await db.event.count({ where: { id: input.eventId, status: "PUBLISHED" } })
    : await db.venue.count({ where: { id: input.venueId, isActive: true } });
  if (exists) recordInteraction({ type: input.type, userId: user?.id, eventId: input.eventId, venueId: input.venueId });
  return { ok: true };
});
