import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/forms/event-form";
import { BackButton } from "@/components/events/event-header-actions";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { venueOptions } from "@/server/services/venues";
import { getMapConfig } from "@/server/services/map";
import { utcToLocalParts } from "@/lib/time";
import { isStaff } from "@/lib/roles";

export const metadata: Metadata = { title: "Editar evento" };

export default async function EditEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/events/${slug}/edit`);
  const e = await db.event.findUnique({
    where: { slug },
    include: { category: true, genres: { include: { genre: true } }, city: true, artists: { orderBy: { position: "asc" }, include: { artist: { select: { name: true } } } } },
  });
  if (!e) notFound();
  if (e.organizerId !== user.id && !isStaff(user.role)) redirect(`/events/${slug}`);

  const tz = e.city.timezone;
  const start = utcToLocalParts(e.startsAt, tz);
  const venues = await venueOptions(e.cityId);
  const cover = e.coverKey ? await db.photo.findFirst({ where: { key: e.coverKey }, select: { id: true, key: true } }) : null;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 md:pt-10">
      <div className="mb-6 flex items-center gap-3">
        <BackButton className="pressable grid size-10 place-items-center rounded-full hover:bg-surface-2" />
        <h1 className="font-display text-2xl font-bold">Editar evento</h1>
      </div>
      <EventForm
        mode="edit"
        eventId={e.id}
        citySlug={e.city.slug}
        cityName={e.city.name}
        venues={venues}
        mapConfig={getMapConfig()}
        moderationNotice={false}
        isDraft={e.status === "DRAFT"}
        initial={{
          title: e.title,
          description: e.description ?? "",
          category: e.category.slug,
          genres: e.genres.map((g) => g.genre.slug),
          venueId: e.venueId,
          locationName: e.locationName,
          address: e.address ?? "",
          lat: e.lat,
          lng: e.lng,
          date: start.date,
          startTime: start.time,
          endTime: e.endsAt ? utcToLocalParts(e.endsAt, tz).time : "",
          isFree: e.priceMin === 0,
          price: e.priceMin ? String(e.priceMin / 100) : "",
          minAge: e.minAge ? String(e.minAge) : "",
          ticketUrl: e.ticketUrl ?? "",
          artists: e.artists.map((a) => a.artist.name).join(", "),
          cover: cover && cover.id ? cover : null,
        }}
      />
    </div>
  );
}
