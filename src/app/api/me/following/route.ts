import { route } from "@/server/http";
import { db } from "@/server/db";
import { followedArtists } from "@/server/services/artists";

/** Venues and artists the signed-in user follows (most recent first). */
export const GET = route({ auth: true, rateLimit: "read" }, async ({ user }) => {
  const [venues, artists] = await Promise.all([
    db.venueFollow.findMany({
      where: { userId: user!.id, venue: { isActive: true } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { venue: { select: { id: true, slug: true, name: true, neighborhood: true } } },
    }),
    followedArtists(user!.id),
  ]);
  return { venues: venues.map((v) => v.venue), artists };
});
