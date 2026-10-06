import type { Metadata } from "next";
import { env } from "@/server/env";
import { jsonLd, venueJsonLd } from "@/lib/structured-data";
import { recordInteraction } from "@/server/services/analytics";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AtSign, Clock, ExternalLink, MapPin, Music2, ShieldCheck, Wallet } from "lucide-react";
import { getSessionUser } from "@/server/auth/session";
import { getVenueDetail, listReviews, venueGallery } from "@/server/services/venues";
import { listEvents } from "@/server/services/events";
import { listPosts } from "@/server/services/posts";
import { getMapConfig } from "@/server/services/map";
import { Cover } from "@/components/ui/cover";
import { Badge, LiveDot, SectionHeader, Stars } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { BackButton } from "@/components/events/event-header-actions";
import { EventRow } from "@/components/events/event-card";
import { VenueActions } from "@/components/venues/venue-actions";
import { ReviewsSection } from "@/components/venues/reviews-section";
import { CommunityGallery } from "@/components/venues/community-gallery";
import { OpenStatus, OpeningHours } from "@/components/venues/opening-hours";
import { DirectionsLink } from "@/components/map/directions-link";
import { openingStatus } from "@/lib/hours";
import { timeAgo } from "@/lib/time";
import { PostGrid } from "@/components/feed/post-grid";
import { StaticMap } from "@/components/map/static-map";
import { Distance } from "@/components/ui/distance";
import { formatPrice } from "@/lib/money";
import { formatNumber } from "@/lib/text";
import { imageUrl } from "@/lib/media";
import { cn } from "@/lib/cn";
import { VENUE_STATUS_LABEL, VENUE_TYPE_LABEL } from "@/lib/nightlife";
import { ZONE_LABEL } from "@/lib/zones";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const v = await getVenueDetail(slug, null);
  if (!v) return { title: "Local", robots: { index: false } };
  const img = imageUrl(v.coverKey, "lg");
  const description = v.description ?? `${v.name}${v.neighborhood ? ` · ${v.neighborhood}` : ""}: próximos eventos, fotos y cómo llegar.`;
  return {
    title: v.name,
    description,
    alternates: { canonical: `/venues/${v.slug}` },
    openGraph: { title: v.name, description, url: `/venues/${v.slug}`, images: img ? [img] : undefined },
    twitter: { card: img ? "summary_large_image" : "summary", title: v.name, description, images: img ? [img] : undefined },
  };
}

export default async function VenuePage({ params }: Props) {
  const { slug } = await params;
  const user = await getSessionUser();
  const venue = await getVenueDetail(slug, user);
  if (!venue) notFound();
  recordInteraction({ type: "VENUE_VIEW", userId: user?.id, venueId: venue.id });

  const [events, reviews, gallery, posts] = await Promise.all([
    listEvents({ timezone: venue.timezone, venueId: venue.id, limit: 8 }),
    listReviews(venue.id),
    venueGallery(venue.id, user?.id),
    listPosts({ venueId: venue.id, viewerId: user?.id, limit: 9 }),
  ]);
  const status = openingStatus(venue.openingHours, venue.timezone);
  const TRUST_LABEL: Record<string, string> = { COMMUNITY: "Comunidad", IMPORTED: "Importado", OFFICIAL: "Oficial", VERIFIED: "Verificado por ORIVEXY NIGHTS" };
  const official = events.items.filter((e) => e.venue?.id === venue.id);
  // The venue's own price, else the cheapest published price of its upcoming events (never guessed).
  const eventPrices = events.items.map((e) => e.priceMin).filter((p): p is number => p != null);
  const venuePrice =
    venue.priceMin != null
      ? formatPrice(venue.priceMin, venue.priceMax, venue.currency)
      : eventPrices.length
        ? Math.min(...eventPrices) === 0
          ? "Hay eventos gratis"
          : `Desde ${formatPrice(Math.min(...eventPrices), null, venue.currency)}`
        : "No verificado";
  const zone = [venue.neighborhood, venue.district].filter(Boolean).join(" · ");
  const music = venue.musicTags.length ? venue.musicTags : venue.genres.map((g) => g.name);
  // Parts of the place seen in its photos (image model), most photos first.
  const zoneCount = new Map<string, number>();
  for (const p of venue.officialPhotos) if (p.zone) zoneCount.set(p.zone, (zoneCount.get(p.zone) ?? 0) + 1);
  const zones = [...zoneCount].sort((a, b) => b[1] - a[1]);

  return (
    <article className="mx-auto max-w-6xl md:px-6 md:pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(venueJsonLd(venue, env.APP_URL)) }} />
      <div className="relative md:overflow-hidden md:rounded-[1.75rem]">
        <Cover imageKey={venue.coverKey} art="club" alt={venue.name} sizes="(min-width: 768px) 1100px, 100vw" priority className="aspect-[4/3] w-full md:aspect-[21/8]" />
        <div className="image-fade absolute inset-0" />
        <div className="absolute top-4 left-4">
          <BackButton />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Badge tone="glass">{VENUE_TYPE_LABEL[venue.type] ?? "Local"}</Badge>
            {venue.status !== "OPEN" && <Badge tone="glass">{VENUE_STATUS_LABEL[venue.status] ?? venue.status}</Badge>}
            {status?.open && (
              <Badge tone="volt">
                <LiveDot className="!bg-on-volt" /> Abierto ahora
              </Badge>
            )}
            {venue.provenance.trust === "VERIFIED" && <Badge tone="glass">Verificado</Badge>}
          </div>
          <h1 className="font-display text-[34px] leading-none font-bold tracking-tight uppercase md:text-6xl">{venue.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
            {venue.ratingCount > 0 && (
              <span className="flex items-center gap-2">
                <Stars value={venue.ratingAvg} size={15} />
                <b>{venue.ratingAvg.toFixed(1).replace(".", ",")}</b>
                <span className="text-muted">{formatNumber(venue.ratingCount)} valoraciones</span>
              </span>
            )}
            <span className="flex items-center gap-1 text-muted">
              <MapPin className="size-4" /> {zone ? `${zone}, ` : ""}
              {venue.city.name}
              <Distance lat={venue.lat} lng={venue.lng} />
            </span>
          </div>
          <OpenStatus hours={venue.openingHours} tz={venue.timezone} className="mt-2 text-[15px]" />
        </div>
      </div>

      <div className="grid gap-8 px-4 pt-5 md:grid-cols-[1fr_340px] md:px-0">
        <div className="min-w-0 space-y-10">
          <VenueActions venueId={venue.id} slug={venue.slug} name={venue.name} following={venue.viewer.following} followerCount={venue.followerCount} />
          {venue.viewer.canManage && (
            <Link href={`/venues/${venue.slug}/manage`} className={buttonClass("secondary", "sm")}>
              Gestionar ficha
            </Link>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info icon={<Music2 className="size-4" />} label="Música y eventos" value={music.join(" · ") || "No verificado"} />
            <Info icon={<Wallet className="size-4" />} label={venue.priceMin != null ? "Precio habitual" : "Entradas"} value={venuePrice} />
            <Info icon={<MapPin className="size-4" />} label="Zona" value={zone || "No verificado"} />
            <Info icon={<ShieldCheck className="size-4" />} label="Estado" value={VENUE_STATUS_LABEL[venue.status] ?? "No verificado"} />
          </div>

          {venue.description && <p className="text-[15px] leading-relaxed text-fg/90">{venue.description}</p>}

          {venue.officialPhotos.length > 0 && (
            <section>
              <SectionHeader title="Fotos" eyebrow="De su web oficial" />
              {zones.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-[13px] font-semibold text-muted">Zonas del local</p>
                  <div className="flex flex-wrap gap-1.5">
                    {zones.map(([z, n]) => (
                      <span key={z} className="rounded-full border border-line-strong px-3 py-1 text-[13px] font-semibold">
                        {ZONE_LABEL[z] ?? z} <span className="text-faint">· {n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {venue.officialPhotos.map((p, i) => (
                  <a key={p.id} href={imageUrl(p.key, "lg") ?? "#"} target="_blank" rel="noopener" className={cn("relative block overflow-hidden rounded-2xl", i === 0 && "col-span-2 row-span-2")}>
                    <Cover imageKey={p.key} blurDataUrl={p.blurDataUrl} alt={`${venue.name} · ${p.zone ? (ZONE_LABEL[p.zone] ?? "foto") : `foto ${i + 1}`}`} sizes={i === 0 ? "(min-width: 768px) 520px, 100vw" : "(min-width: 768px) 260px, 50vw"} className="aspect-square w-full" />
                    {p.zone && <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{ZONE_LABEL[p.zone] ?? p.zone}</span>}
                  </a>
                ))}
              </div>
              {zones.length > 0 && (
                <p className="mt-2 text-[11px] text-faint">Zonas detectadas automáticamente en las fotos por una red neuronal (CLIP); puede equivocarse.</p>
              )}
            </section>
          )}

          <section id="eventos" className="scroll-mt-24">
            <SectionHeader
              eyebrow="Agenda"
              title="Próximos eventos"
              action={venue.viewer.canManage && <Link href={`/events/new?venue=${venue.id}`} className={buttonClass("secondary", "sm")}>Crear evento</Link>}
            />
            {events.items.length ? (
              <div className="divide-y divide-line">
                {events.items.map((e) => (
                  <div key={e.id} className="py-1">
                    <EventRow event={e} showDay />
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No hay eventos anunciados.</p>
            )}
            {official.length > 0 && <p className="mt-2 text-[12px] text-faint">Los eventos publicados por el propio local aparecen como “Oficial”.</p>}
          </section>

          <CommunityGallery venueId={venue.id} initial={gallery} />

          {posts.items.length > 0 && (
            <section>
              <SectionHeader title="Publicaciones" />
              <PostGrid posts={posts.items} />
            </section>
          )}

          <section>
            <SectionHeader title="Valoraciones" />
            <ReviewsSection
              venue={{ id: venue.id, name: venue.name, ratingAvg: venue.ratingAvg, ratingCount: venue.ratingCount, subScores: venue.subScores, ratingDistribution: venue.ratingDistribution }}
              myReview={venue.viewer.review}
              initial={reviews}
            />
          </section>
        </div>

        <aside className="space-y-4 md:sticky md:top-24 md:self-start">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <StaticMap config={getMapConfig()} lat={venue.lat} lng={venue.lng} variant="venue" className="h-40 w-full" />
            <div className="space-y-3 p-4">
              <p className="text-sm">{venue.address || <span className="text-muted">Dirección no disponible</span>}</p>
              {venue.phone && (
                <a href={`tel:${venue.phone.replace(/\s+/g, "")}`} className="block text-sm text-muted hover:text-fg">
                  {venue.phone}
                </a>
              )}
              <DirectionsLink lat={venue.lat} lng={venue.lng} name={venue.name} className={buttonClass("secondary", "sm", "w-full")}>
                Cómo llegar <ExternalLink className="size-3.5" />
              </DirectionsLink>
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold tracking-wider text-muted uppercase">
              <Clock className="size-4" /> Horario
            </h3>
            {status && <p className={cn("mb-3 text-sm font-semibold", status.open ? "text-emerald-300" : "text-fg")}>{status.todayLabel}</p>}
            <OpeningHours hours={venue.openingHours} tz={venue.timezone} />
            {venue.provenance.hoursUpdatedAt && <p className="mt-3 text-[11px] text-faint">Horario actualizado {timeAgo(venue.provenance.hoursUpdatedAt)}</p>}
          </div>
          {(venue.instagram || venue.website) && (
            <div className="flex gap-2">
              {venue.instagram && (
                <a
                  href={`https://www.instagram.com/${venue.instagram.replace(/^@/, "")}/`}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm"
                >
                  <AtSign className="size-4" /> {venue.instagram.replace(/^@/, "")}
                </a>
              )}
              {venue.website && (
                <a href={venue.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm">
                  Web oficial <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          )}
          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Información: {TRUST_LABEL[venue.provenance.trust] ?? venue.provenance.trust}
            {venue.provenance.sourceName && (
              <>
                {" · "}Fuente:{" "}
                {venue.provenance.sourceUrl ? (
                  <a href={venue.provenance.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                    {venue.provenance.sourceName}
                  </a>
                ) : (
                  venue.provenance.sourceName
                )}
              </>
            )}
            {venue.provenance.lastVerifiedAt && ` · comprobado ${timeAgo(venue.provenance.lastVerifiedAt)}`}
            {venue.provenance.attribution && <> · {venue.provenance.attribution}</>}
          </p>
        </aside>
      </div>
    </article>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        {icon} {label}
      </p>
      <p className="mt-1 text-[15px] font-bold">{value}</p>
    </div>
  );
}
