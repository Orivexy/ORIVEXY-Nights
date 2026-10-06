import { route } from "@/server/http";
import { submitEvent } from "@/server/services/events";

/** Publishes a draft (or sends it to review): the organizer, after the preview. */
export const POST = route<{ id: string }>({ auth: true, rateLimit: "createEvent" }, async ({ params, user }) => submitEvent(user!, params.id));
