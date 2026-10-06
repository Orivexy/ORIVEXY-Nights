"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/misc";
import { PostGrid } from "@/components/feed/post-grid";
import { EventList } from "@/components/events/event-list";
import { useInfinite } from "@/hooks/use-infinite";
import { api, reviveDates } from "@/lib/api-client";
import { imageUrl } from "@/lib/media";
import type { EventCardData, FeedPost, Page, PhotoData } from "@/lib/types";

type Tab = "posts" | "events" | "photos" | "saved" | "following";

export function ProfileTabs({ userId, isSelf, initialPosts }: { userId: string; isSelf: boolean; initialPosts: Page<FeedPost> }) {
  const [tab, setTab] = useState<Tab>("posts");
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "posts", label: "Publicaciones" },
    { value: "events", label: "Eventos" },
    { value: "photos", label: "Fotos" },
    ...(isSelf ? [{ value: "saved" as const, label: "Guardados" }, { value: "following" as const, label: "Siguiendo" }] : []),
  ];
  return (
    <div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="sticky top-14 z-20 bg-ink md:top-16" />
      <div className="pt-4">
        {tab === "posts" && <Posts initial={initialPosts} url={`/api/users/${userId}/posts`} />}
        {tab === "events" && <Lazy<EventCardData> url={`/api/users/${userId}/events`} render={(p, url) => <EventList initial={p} endpoint={url} layout="rows" emptyTitle="Todavía no ha creado fiestas" emptyText=" " />} />}
        {tab === "photos" && <Lazy<PhotoData & { postId: string | null; venueSlug: string | null }> url={`/api/users/${userId}/photos`} render={(p, url) => <Photos initial={p} url={url} />} />}
        {tab === "saved" && <Saved />}
        {tab === "following" && <Following />}
      </div>
    </div>
  );
}

function Posts({ initial, url, empty = "Aún no hay publicaciones" }: { initial: Page<FeedPost>; url: string; empty?: string }) {
  const { items, sentinel, loading } = useInfinite(initial, (c) => `${url}${url.includes("?") ? "&" : "?"}cursor=${c}`);
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <>
      <PostGrid posts={items} />
      <div ref={sentinel} className="flex justify-center py-4">{loading && <Loader2 className="size-5 animate-spin text-muted" />}</div>
    </>
  );
}

/** Fetches the first page when a tab is first opened. */
function Lazy<T>({ url, render }: { url: string; render: (page: Page<T>, url: string) => React.ReactNode }) {
  const [page, setPage] = useState<Page<T> | null>(null);
  useEffect(() => {
    api.get<Page<T>>(url).then((p) => setPage(reviveDates(p))).catch(() => setPage({ items: [], nextCursor: null }));
  }, [url]);
  if (!page) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  return <>{render(page, url)}</>;
}

function Photos({ initial, url }: { initial: Page<PhotoData & { postId: string | null; venueSlug: string | null }>; url: string }) {
  const { items, sentinel } = useInfinite(initial, (c) => `${url}?cursor=${c}`);
  if (!items.length) return <EmptyState title="Sin fotos todavía" />;
  return (
    <>
      <div className="grid grid-cols-3 gap-1 md:gap-2">
        {items.map((p) => (
          <Link key={p.id} href={p.postId ? `/social?post=${p.postId}` : `/venues/${p.venueSlug}`} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
            <Image src={imageUrl(p.key, "sm")!} alt="" fill sizes="(min-width: 768px) 240px, 33vw" className="object-cover" placeholder={p.blurDataUrl ? "blur" : "empty"} blurDataURL={p.blurDataUrl ?? undefined} />
          </Link>
        ))}
      </div>
      <div ref={sentinel} />
    </>
  );
}

function Saved() {
  const [kind, setKind] = useState<"events" | "posts">("events");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["events", "posts"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`h-9 rounded-full px-4 text-[13px] font-semibold ${kind === k ? "bg-fg text-ink" : "border border-line-strong"}`}>
            {k === "events" ? "Eventos" : "Publicaciones"}
          </button>
        ))}
      </div>
      {kind === "events" ? (
        <Lazy<EventCardData> key="e" url="/api/me/saved?type=events" render={(p, url) => <EventList initial={p} endpoint={url} layout="rows" emptyTitle="No has guardado eventos" emptyText="Guarda planes para tenerlos a mano." />} />
      ) : (
        <Lazy<FeedPost> key="p" url="/api/me/saved?type=posts" render={(p, url) => <Posts initial={p} url={url} empty="No has guardado publicaciones" />} />
      )}
    </div>
  );
}

type Followed = { venues: Array<{ id: string; slug: string; name: string; neighborhood: string | null }>; artists: Array<{ id: string; slug: string; name: string; followerCount: number }> };

/** Venues and artists the user follows. */
function Following() {
  const [data, setData] = useState<Followed | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.get<Followed>("/api/me/following").then(setData).catch(() => setFailed(true));
  }, []);
  if (failed) return <EmptyState title="No se ha podido cargar">Inténtalo de nuevo en un momento.</EmptyState>;
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  if (!data.venues.length && !data.artists.length) return <EmptyState title="Aún no sigues nada">Sigue locales y artistas para enterarte de sus nuevos eventos.</EmptyState>;
  const row = "flex items-center justify-between rounded-2xl px-3 py-3 hover:bg-surface";
  return (
    <div className="space-y-6">
      {data.venues.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-bold tracking-wider text-muted uppercase">Locales</h3>
          <ul>{data.venues.map((v) => <li key={v.id}><Link href={`/venues/${v.slug}`} className={row}><span className="font-semibold">{v.name}</span><span className="text-sm text-muted">{v.neighborhood}</span></Link></li>)}</ul>
        </section>
      )}
      {data.artists.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-bold tracking-wider text-muted uppercase">Artistas</h3>
          <ul>{data.artists.map((a) => <li key={a.id}><Link href={`/artists/${a.slug}`} className={row}><span className="font-semibold">{a.name}</span><span className="text-sm text-muted">{a.followerCount} seguidores</span></Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
