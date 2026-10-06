import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ExternalLink, Music2 } from "lucide-react";
import { getSessionUser } from "@/server/auth/session";
import { getArtist } from "@/server/services/artists";
import { FollowButton } from "@/components/social/follow-button";
import { EventCard } from "@/components/events/event-card";
import { EmptyState, SectionHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";

type Props = { params: Promise<{ slug: string }> };

const load = cache((slug: string, viewerId: string | null) => getArtist(slug, viewerId));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await load(slug, null);
  if (!a) return { title: "Artista", robots: { index: false } };
  const description = a.bio ?? `${a.name}: próximas fechas y eventos en los que ha actuado.`;
  return { title: a.name, description, alternates: { canonical: `/artists/${a.slug}` }, openGraph: { title: a.name, description, url: `/artists/${a.slug}` } };
}

export default async function ArtistPage({ params }: Props) {
  const { slug } = await params;
  const user = await getSessionUser();
  const artist = await load(slug, user?.id ?? null);
  if (!artist) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-12 md:px-6 md:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.18em] text-volt uppercase">
            <Music2 className="size-3.5" /> Artista
          </p>
          <h1 className="mt-1 font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">{artist.name}</h1>
          <p className="mt-2 text-sm text-muted">
            {artist.followerCount} {artist.followerCount === 1 ? "seguidor" : "seguidores"} · {artist.upcoming.length} {artist.upcoming.length === 1 ? "fecha próxima" : "fechas próximas"}
          </p>
          {artist.bio && <p className="mt-3 max-w-prose text-[15px] text-fg/90">{artist.bio}</p>}
        </div>
        <div className="flex items-center gap-2">
          {artist.website && (
            <a href={artist.website} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("ghost", "sm")}>
              Web <ExternalLink className="size-3.5" />
            </a>
          )}
          <FollowButton kind="artist" targetId={artist.id} initial={artist.following} />
        </div>
      </header>

      <section className="mt-8">
        <SectionHeader title="Próximas fechas" />
        {artist.upcoming.length ? (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {artist.upcoming.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        ) : (
          <EmptyState title="Sin fechas anunciadas">Síguele y te avisaremos cuando se publique su próximo evento.</EmptyState>
        )}
      </section>

      {artist.past.length > 0 && (
        <section className="mt-10">
          <SectionHeader title="Eventos pasados" />
          <div className="grid grid-cols-1 gap-4 opacity-80 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {artist.past.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </section>
      )}
    </div>
  );
}
