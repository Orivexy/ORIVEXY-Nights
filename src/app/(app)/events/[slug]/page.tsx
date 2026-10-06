import type { Metadata } from "next";
import { cache } from "react";
import { env } from "@/server/env";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BadgeCheck, Calendar, Camera, Clock, Euro, ExternalLink, MapPin, Music2, ShieldCheck, Ticket, Users } from "lucide-react";
import { getSessionUser } from "@/server/auth/session";
import { getEventDetail, listEvents } from "@/server/services/events";
import { listPosts } from "@/server/services/posts";
import { getMapConfig } from "@/server/services/map";
import { Cover } from "@/components/ui/cover";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge, LiveDot, SectionHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Rail } from "@/components/ui/rail";
import { EventActions } from "@/components/events/event-actions";
import { BackButton, EventHeaderActions } from "@/components/events/event-header-actions";
import { EventCard } from "@/components/events/event-card";
import { RatingPill } from "@/components/venues/venue-card";
import { PostGrid } from "@/components/feed/post-grid";
import { StaticMap } from "@/components/map/static-map";
import { Distance } from "@/components/ui/distance";
import { formatPrice } from "@/lib/money";
import { DirectionsLink } from "@/components/map/directions-link";
import { eventEnd, formatEventTime, formatLongDate, formatTime, isHappeningNow, timeAgo } from "@/lib/time";
import { imageUrl } from "@/lib/media";
import { eventJsonLd, jsonLd } from "@/lib/structured-data";
import { PublishDraft } from "@/components/events/publish-draft";

type Props = { params: Promise<{ slug: string }> };

// One query per request for metadata and page.
const loadEvent = cache((slug: string, viewer: Awaited<ReturnType<typeof getSessionUser>>) => getEventDetail(slug, viewer));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug, null);
  if (!event) return { title: "Evento", robots: { index: false } };
  const img = imageUrl(event.coverKey, "lg");
  const title = event.title;
  const description = `${formatLongDate(event.startsAt, event.timezone)} · ${event.venue?.name ?? event.locationName} · ${formatPrice(event.priceMin, event.priceMax, event.currency)}`;
  return {
    title,
    description,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: { type: "article", title, description, url: `/events/${event.slug}`, images: img ? [img] : undefined },
    twitter: { card: img ? "summary_large_image" : "summary", title, description, images: img ? [img] : undefined },
  };
}

const STATUS_BANNER: Record<string, { tone: "warn" | "danger" | "info"; text: string }> = {
  DRAFT: { tone: "info", text: "Vista previa del borrador: solo tú lo ves. Publícalo cuando esté listo." },
  PENDING: { tone: "warn", text: "Pendiente de revisión: solo tú y el equipo de moderación podéis verlo." },
  REJECTED: { tone: "danger", text: "Este evento no ha sido aprobado. Edítalo para volver a enviarlo a revisión." },
  CANCELLED: { tone: "danger", text: "Evento cancelado por la organización." },
};

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const user = await getSessionUser();
  const event = await loadEvent(slug, user);
  if (!event) notFound();

  const [posts, more, similar] = await Promise.all([
    listPosts({ eventId: event.id, viewerId: user?.id, limit: 9 }),
    event.venue
      ? listEvents({ timezone: event.timezone, venueId: event.venue.id, excludeIds: [event.id], limit: 6 })
      : Promise.resolve({ items: [] }),
    listEvents({
      timezone: event.timezone,
      ...(event.genres.length ? { genres: event.genres.map((g) => g.slug) } : { categories: [event.category.slug] }),
      excludeIds: [event.id],
      sort: "popular",
      limit: 8,
    }),
  ]);
  const live = isHappeningNow(event.startsAt, event.endsAt, undefined, event.timeUnknown);
  const ended = eventEnd(event.startsAt, event.endsAt, event.timeUnknown) < new Date();
  const tz = event.timezone;
  const banner = STATUS_BANNER[event.status];
  const finished = ended && event.status === "PUBLISHED";

  return (
    <article className="mx-auto max-w-6xl md:px-6 md:pt-6">
      {/* Hero */}
      <div className="relative md:overflow-hidden md:rounded-[1.75rem]">
        <Cover imageKey={event.coverKey} art={event.category.slug} alt={event.title} sizes="(min-width: 768px) 1100px, 100vw" priority className="aspect-[4/5] w-full sm:aspect-[16/9] md:aspect-[21/9]" />
        <div className="image-fade absolute inset-0" />
        <div className="absolute inset-x-4 top-4 flex justify-between">
          <BackButton />
          <EventHeaderActions eventId={event.id} slug={event.slug} canEdit={event.canEdit} status={event.status} />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="glass">
              {event.category.emoji} {event.category.name}
            </Badge>
            {live && (
              <Badge tone="volt">
                <LiveDot className="!bg-on-volt" /> Ahora
              </Badge>
            )}
            {event.trust === "VERIFIED" && (
              <Badge tone="volt">
                <BadgeCheck className="size-3" /> Verificado
              </Badge>
            )}
            {event.isOfficial && (
              <Badge tone="glass">
                <ShieldCheck className="size-3" /> Oficial
              </Badge>
            )}
          </div>
          <h1 className="font-display text-[34px] leading-[1.02] font-bold tracking-tight text-balance uppercase md:text-6xl">{event.title}</h1>
          <p className="mt-2 flex items-center gap-1.5 text-[15px] text-muted">
            <MapPin className="size-4" /> {event.venue?.name ?? event.locationName}
            {event.city && `, ${event.city.name}`}
          </p>
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(eventJsonLd(event, env.APP_URL)) }} />

      {banner && (
        <div className={`mx-4 mt-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm md:mx-0 ${banner.tone === "warn" ? "bg-warn/10 text-warn" : banner.tone === "info" ? "bg-surface-2 text-fg" : "bg-danger/10 text-danger"}`}>
          <span className="flex-1">{banner.text}</span>
          {event.status === "DRAFT" && event.canEdit && <PublishDraft eventId={event.id} />}
        </div>
      )}
      {finished && (
        <div role="status" className="mx-4 mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold md:mx-0">
          Evento finalizado · {formatLongDate(event.startsAt, tz)}
        </div>
      )}

      <div className="grid gap-8 px-4 pt-6 md:grid-cols-[1fr_360px] md:gap-x-8 md:px-0">
        <div className="min-w-0 md:col-start-1">
          {/* Key facts */}
          <dl className="grid grid-cols-2 gap-3">
            <Fact icon={<Calendar className="size-4" />} label="Fecha" value={formatLongDate(event.startsAt, tz)} />
            <Fact
              icon={<Clock className="size-4" />}
              label="Horario"
              value={`${formatEventTime(event.startsAt, tz, event.timeUnknown)}${event.endsAt && !event.timeUnknown ? ` — ${formatTime(event.endsAt, tz)}` : ""}${event.doorsAt ? ` · puertas ${formatTime(event.doorsAt, tz)}` : ""}`}
            />
            <Fact icon={<Euro className="size-4" />} label="Entrada" value={formatPrice(event.priceMin, event.priceMax, event.currency)} highlight={event.priceMin === 0} />
            <Fact icon={<Users className="size-4" />} label="Edad" value={event.minAge ? `+${event.minAge}` : "Todas las edades"} />
          </dl>
        </div>

        {/* Sidebar: actions + people */}
        <aside className="space-y-6 md:sticky md:top-24 md:col-start-2 md:row-span-2 md:row-start-1 md:self-start">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <EventActions
              eventId={event.id}
              slug={event.slug}
              title={event.title}
              disabled={event.status !== "PUBLISHED" || ended}
              initial={{ ...event.viewer, interestedCount: event.interestedCount, goingCount: event.goingCount }}
            />
            {finished ? null : event.ticketUrl ? (
              <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("primary", "lg", "mt-3 w-full")}>
                <Ticket className="size-4" /> Comprar entradas{event.priceMin != null && ` · ${formatPrice(event.priceMin, event.priceMax, event.currency)}`}
              </a>
            ) : (
              event.officialUrl && (
                <a href={event.officialUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("outline", "md", "mt-3 w-full")}>
                  <Ticket className="size-4" /> Entradas e info oficial
                </a>
              )
            )}
            {event.attendeesPreview.length > 0 && (
              <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
                <AvatarStack users={event.attendeesPreview} max={5} />
                <p className="text-[13px] text-muted">
                  {event.attendeesPreview[0]!.displayName}
                  {event.goingCount + event.interestedCount > 1 && ` y ${event.goingCount + event.interestedCount - 1} más`} se apuntan
                </p>
              </div>
            )}
          </div>

          {event.organizer ? (
            <Link href={`/u/${event.organizer.username}`} className="pressable flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:bg-surface-2">
              <Avatar user={event.organizer} size={44} />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Organiza</p>
                <p className="truncate font-semibold">{event.organizer.displayName}</p>
                <p className="truncate text-[13px] text-faint">@{event.organizer.username}</p>
              </div>
            </Link>
          ) : (
            event.organizerName && (
              <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Organiza</p>
                <p className="truncate font-semibold">{event.organizerName}</p>
              </div>
            )
          )}
          {event.officialUrl && (
            <a href={event.officialUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("ghost", "sm", "w-full")}>
              Web oficial del evento <ExternalLink className="size-3.5" />
            </a>
          )}
        </aside>

        <div className="min-w-0 space-y-8 md:col-start-1">
          {event.genres.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Music2 className="size-4 text-muted" />
              {event.genres.map((g) => (
                <Link key={g.slug} href={`/discover?genre=${g.slug}`} className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold hover:bg-surface-3">
                  {g.name}
                </Link>
              ))}
            </div>
          )}

          {event.artists.length > 0 && (
            <section>
              <h2 className="mb-2 text-[13px] font-bold tracking-wider text-muted uppercase">Line-up</h2>
              <ul className="flex flex-wrap gap-2">
                {event.artists.map((a) => (
                  <li key={a.id}>
                    <Link href={`/artists/${a.slug}`} className="inline-flex rounded-full border border-line-strong px-3.5 py-1.5 text-[14px] font-semibold hover:bg-surface-2">
                      {a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {event.description && (
            <section>
              <h2 className="mb-2 text-[13px] font-bold tracking-wider text-muted uppercase">Descripción</h2>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-fg/90">{event.description}</p>
            </section>
          )}

          {/* Location */}
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <StaticMap config={getMapConfig()} lat={event.lat} lng={event.lng} variant={event.category.slug} className="h-44 w-full" />
            <div className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{event.venue?.name ?? event.locationName}</p>
                <p className="truncate text-sm text-muted">
                  {event.address ?? event.locationName}
                  <Distance lat={event.lat} lng={event.lng} />
                </p>
              </div>
              <DirectionsLink lat={event.lat} lng={event.lng} name={event.locationName} className={buttonClass("secondary", "sm")}>
                Cómo llegar <ExternalLink className="size-3.5" />
              </DirectionsLink>
            </div>
            {event.venue && (
              <Link href={`/venues/${event.venue.slug}`} className="flex items-center justify-between border-t border-line px-4 py-3 text-sm hover:bg-surface-2">
                <span className="font-semibold">Ver local</span>
                <RatingPill avg={event.venue.ratingAvg} count={event.venue.ratingCount} />
              </Link>
            )}
          </section>

          {event.photos.length > 1 && (
            <section>
              <SectionHeader title="Fotos" />
              <div className="grid grid-cols-3 gap-1.5">
                {event.photos.map((p) => (
                  <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                    <Image src={imageUrl(p.key, "sm")!} alt="" fill sizes="(min-width: 768px) 240px, 33vw" className="object-cover" placeholder={p.blurDataUrl ? "blur" : "empty"} blurDataURL={p.blurDataUrl ?? undefined} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionHeader
              title="De la comunidad"
              action={
                user && (
                  <Link href={`/create/post?event=${event.id}`} className={buttonClass("secondary", "sm")}>
                    <Camera className="size-4" /> Subir
                  </Link>
                )
              }
            />
            {posts.items.length ? (
              <PostGrid posts={posts.items} />
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
                {ended ? "¿Estuviste? Sube tus fotos y vídeos de la noche." : "Después de la fiesta, las fotos y vídeos aparecerán aquí."}
              </p>
            )}
          </section>
        </div>

      </div>

      {more.items.length > 0 && event.venue && (
        <section className="mt-10 px-4 md:px-0">
          <SectionHeader title={`Más en ${event.venue.name}`} />
          <Rail itemClassName="w-[70vw] sm:w-[260px]">
            {more.items.map((e) => <EventCard key={e.id} event={e} />)}
          </Rail>
        </section>
      )}
      {similar.items.length > 0 && (
        <section className="mt-10 px-4 md:px-0">
          <SectionHeader title="Eventos similares" />
          <Rail itemClassName="w-[70vw] sm:w-[260px]">
            {similar.items.map((e) => <EventCard key={e.id} event={e} />)}
          </Rail>
        </section>
      )}
      {event.attribution && event.attribution.sources.length > 0 && (
        <p className="mt-10 px-4 text-[12px] text-faint md:px-0">
          Información obtenida de{" "}
          {event.attribution.sources.map((src, i) => (
            <span key={`${src.name}-${i}`}>
              {i > 0 && ", "}
              {src.url ? (
                <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="underline-offset-2 hover:underline">
                  {src.name}
                </a>
              ) : (
                src.name
              )}
            </span>
          ))}
          {event.attribution.lastSyncedAt && ` · actualizada ${timeAgo(event.attribution.lastSyncedAt)}`}. Confirma los detalles con la organización.
        </p>
      )}
    </article>
  );
}

function Fact({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <dt className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        {icon} {label}
      </dt>
      <dd className={`mt-1 text-[15px] font-bold ${highlight ? "text-volt" : ""}`}>{value}</dd>
    </div>
  );
}
