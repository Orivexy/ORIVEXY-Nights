/** Liveness probe (desktop launcher, uptime monitors). Never touches the database. */
export const dynamic = "force-dynamic";

export function GET() {
  // The desktop launcher checks this id to be sure the port is its own server, not another app.
  return Response.json({ ok: true, app: "orivexy-nights", instance: process.env.APP_INSTANCE_ID ?? null });
}
