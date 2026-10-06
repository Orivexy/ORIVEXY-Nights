import { z } from "zod";
import { route, parseJson } from "@/server/http";
import { moderateEvent, setEventHidden } from "@/server/services/events";
import { markEventSpam } from "@/server/services/admin";
import { deleteEvent, setEventFeatured } from "@/server/services/admin";
import { markEventVerified } from "@/server/discovery/review";

const body = z.object({
  /** spam = rejected, and the organizer's account is suspended when it is a community account. */
  decision: z.enum(["approve", "reject", "spam"]).optional(),
  hidden: z.boolean().optional(),
  featured: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>({ auth: "moderator", audit: { action: "event.moderate", targetType: "EVENT" } }, async ({ req, params, user }) => {
  const input = await parseJson(req, body);
  if (input.decision === "spam") await markEventSpam(params.id, user!.role);
  else if (input.decision) await moderateEvent(params.id, input.decision);
  if (input.hidden !== undefined) await setEventHidden(params.id, input.hidden);
  if (input.featured !== undefined) await setEventFeatured(params.id, input.featured);
  if (input.verified !== undefined) await markEventVerified(params.id, input.verified);
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ auth: "admin", audit: { action: "event.delete", targetType: "EVENT" } }, async ({ params }) => {
  await deleteEvent(params.id);
  return { ok: true };
});
