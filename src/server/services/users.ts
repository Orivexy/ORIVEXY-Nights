import "server-only";
import { db } from "../db";
import { badRequest, notFound } from "../http";
import type { SessionUser } from "../auth/session";
import { nextOffset, parseOffset, photoSelect, toUserMini, userMiniSelect } from "./mappers";
import { notify } from "./notifications";
import { assertNotBlocked, notBlockedWith } from "./blocks";
import { getCityBySlug } from "./cities";
import { buildSearchText } from "@/lib/text";
import { SYSTEM_USERNAMES } from "@/config/system";
import type { Page, PhotoData, ProfileData, UserMini } from "@/lib/types";
import type { z } from "zod";
import type { profileUpdateSchema } from "@/lib/validators";

export async function getProfile(username: string, viewerId?: string): Promise<ProfileData | null> {
  const p = await db.profile.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      userId: true,
      username: true,
      displayName: true,
      avatarKey: true,
      bio: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      createdAt: true,
      city: { select: { slug: true, name: true } },
      user: { select: { status: true } },
    },
  });
  if (!p || (p.user.status === "SUSPENDED" && p.userId !== viewerId)) return null;

  const [eventCount, following, followsYou, blocks] = await Promise.all([
    db.event.count({ where: { organizerId: p.userId, status: "PUBLISHED" } }),
    viewerId ? db.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: p.userId } } }) : null,
    viewerId ? db.follow.findUnique({ where: { followerId_followingId: { followerId: p.userId, followingId: viewerId } } }) : null,
    viewerId && viewerId !== p.userId
      ? db.block.findMany({ where: { OR: [{ blockerId: viewerId, blockedId: p.userId }, { blockerId: p.userId, blockedId: viewerId }] }, select: { blockerId: true } })
      : [],
  ]);

  return {
    id: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatarKey: p.avatarKey,
    bio: p.bio,
    followerCount: p.followerCount,
    followingCount: p.followingCount,
    postCount: p.postCount,
    eventCount,
    city: p.city,
    joinedAt: p.createdAt,
    viewer: {
      isSelf: viewerId === p.userId,
      following: Boolean(following),
      followsYou: Boolean(followsYou),
      blocked: blocks.some((b) => b.blockerId === viewerId),
      blockedBy: blocks.some((b) => b.blockerId === p.userId),
    },
  };
}

export async function setFollow(followerId: string, followingId: string, follow: boolean) {
  if (followerId === followingId) throw badRequest("No puedes seguirte a ti mismo");
  const target = await db.user.findFirst({ where: { id: followingId, status: "ACTIVE" }, select: { id: true } });
  if (!target) throw notFound("Usuario no encontrado");
  if (follow) await assertNotBlocked(followerId, followingId);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } });
    const changed = follow ? !existing : Boolean(existing);
    if (changed) {
      const step = follow ? 1 : -1;
      if (follow) await tx.follow.create({ data: { followerId, followingId } });
      else await tx.follow.delete({ where: { followerId_followingId: { followerId, followingId } } });
      await tx.profile.update({ where: { userId: followerId }, data: { followingCount: { increment: step } } });
      await tx.profile.update({ where: { userId: followingId }, data: { followerCount: { increment: step } } });
    }
    const p = await tx.profile.findUniqueOrThrow({ where: { userId: followingId }, select: { followerCount: true } });
    return { following: follow, followerCount: p.followerCount, created: follow && changed };
  });

  if (result.created) {
    await notify({ userId: followingId, actorId: followerId, type: "FOLLOW", dedupeKey: `follow:${followerId}:${followingId}` });
  }
  return { following: result.following, followerCount: result.followerCount };
}

export async function listFollows(
  userId: string,
  direction: "followers" | "following",
  viewerId?: string,
  cursor?: string,
  limit = 30,
): Promise<Page<UserMini & { viewerFollows: boolean }>> {
  const offset = parseOffset(cursor);
  const rows =
    direction === "followers"
      ? (await db.follow.findMany({
          where: { followingId: userId },
          orderBy: { createdAt: "desc" },
          select: { follower: { select: userMiniSelect } },
          skip: offset,
          take: limit + 1,
        })).map((r) => r.follower)
      : (await db.follow.findMany({
          where: { followerId: userId },
          orderBy: { createdAt: "desc" },
          select: { following: { select: userMiniSelect } },
          skip: offset,
          take: limit + 1,
        })).map((r) => r.following);
  const page = rows.slice(0, limit);
  const viewerFollows = viewerId
    ? new Set(
        (await db.follow.findMany({
          where: { followerId: viewerId, followingId: { in: page.map((u) => u.id) } },
          select: { followingId: true },
        })).map((f) => f.followingId),
      )
    : new Set<string>();
  return {
    items: page.map((u) => ({ ...toUserMini(u), viewerFollows: viewerFollows.has(u.id) })),
    nextCursor: nextOffset(offset, limit, rows.length),
  };
}

/**
 * People to follow: popular accounts in the viewer's city that they don't
 * follow yet, ranked by followers and recent activity.
 */
export async function suggestedUsers(viewerId: string | undefined, cityId: string, limit = 10) {
  const rows = await db.profile.findMany({
    where: {
      user: {
        status: "ACTIVE",
        ...(viewerId ? { id: { not: viewerId }, followers: { none: { followerId: viewerId } }, ...notBlockedWith(viewerId) } : {}),
      },
      OR: [{ cityId }, { cityId: null }],
      username: { notIn: [...SYSTEM_USERNAMES] },
    },
    orderBy: [{ followerCount: "desc" }, { postCount: "desc" }],
    select: { userId: true, username: true, displayName: true, avatarKey: true, bio: true, followerCount: true },
    take: limit,
  });
  return rows.map(({ userId, ...r }) => ({ id: userId, ...r }));
}

export async function updateProfile(user: SessionUser, input: z.infer<typeof profileUpdateSchema>) {
  const data: Record<string, unknown> = {};
  if (input.username && input.username !== user.username) {
    const taken = await db.profile.findUnique({ where: { username: input.username }, select: { userId: true } });
    if (taken) throw badRequest("Ese nombre de usuario ya existe", { username: "Ya está en uso" });
    data.username = input.username;
  }
  if (input.displayName) data.displayName = input.displayName;
  if (input.bio !== undefined) data.bio = input.bio ?? null;
  if (input.favoriteGenres !== undefined) data.favoriteGenres = [...new Set(input.favoriteGenres)];
  if (input.citySlug) {
    const city = await getCityBySlug(input.citySlug);
    if (!city) throw badRequest("Ciudad no válida");
    data.cityId = city.id;
  }
  if (input.avatarPhotoId !== undefined) {
    if (input.avatarPhotoId === null) data.avatarKey = null;
    else {
      const photo = await db.photo.findFirst({
        where: { id: input.avatarPhotoId, uploaderId: user.id },
        select: { key: true },
      });
      if (!photo) throw badRequest("Foto no válida");
      data.avatarKey = photo.key;
    }
  }
  const username = (data.username as string | undefined) ?? user.username;
  const displayName = (data.displayName as string | undefined) ?? user.displayName;
  data.searchText = buildSearchText(username, displayName);

  return db.profile.update({
    where: { userId: user.id },
    data,
    select: { username: true, displayName: true, bio: true, avatarKey: true },
  });
}

/** All photos a user has shared (posts + venue galleries). */
export async function userPhotos(userId: string, cursor?: string, limit = 24): Promise<Page<PhotoData & { postId: string | null; venueSlug: string | null }>> {
  const offset = parseOffset(cursor);
  const rows = await db.photo.findMany({
    where: {
      uploaderId: userId,
      status: "VISIBLE",
      OR: [{ post: { status: "VISIBLE" } }, { venueId: { not: null }, postId: null }],
    },
    orderBy: { createdAt: "desc" },
    select: { ...photoSelect, postId: true, venue: { select: { slug: true } } },
    skip: offset,
    take: limit + 1,
  });
  return {
    items: rows.slice(0, limit).map(({ venue, ...p }) => ({ ...p, venueSlug: venue?.slug ?? null })),
    nextCursor: nextOffset(offset, limit, rows.length),
  };
}
