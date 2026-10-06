import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { TicketCard } from "@/components/events/ticket-card";
import { EventCard } from "@/components/events/event-card";
import { VenueCard } from "@/components/venues/venue-card";
import { NearbyEvents } from "@/components/events/nearby-events";
import { HomeMap } from "@/components/map/home-map";
import { Rail } from "@/components/ui/rail";
import { EmptyState } from "@/components/ui/misc";
import { getSessionUser } from "@/server/auth/session";
import { getCurrentCity } from "@/server/services/cities";
import { listEvents } from "@/server/services/events";
import { listVenues } from "@/server/services/venues";
import { recommendedEvents } from "@/server/services/recommendations";
import { getMapConfig, getMapPlaces } from "@/server/services/map";
import type { EventCardData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Home: the clubs on a large map, then discovery rails. Each rail queries the
 * database with its own filter; empty rails are not shown.
 */
export default async function HomePage() {
  const [city, user] = await Promise.all([getCurrentCity(), getSessionUser()]);
  const base = { cityId: city.id, timezone: city.timezone };
  const [places, forYou, tonight, weekend, featured, festivals, popular, newest, upcoming, clubs] = await Promise.all([
    getMapPlaces(city),
    user ? recommendedEvents(user.id, city.id, { limit: 10 }) : Promise.resolve([]),
    listEvents({ ...base, when: "today", sort: "soonest", limit: 10 }),
    listEvents({ ...base, when: "weekend", sort: "popular", limit: 10 }),
    listEvents({ ...base, featured: true, sort: "soonest", limit: 10 }),
    listEvents({ ...base, categories: ["festival"], sort: "soonest", limit: 10 }),
    listEvents({ ...base, when: "week", sort: "popular", limit: 10 }),
    listEvents({ ...base, sort: "newest", limit: 10 }),
    listEvents({ ...base, when: "upcoming", sort: "soonest", limit: 12 }),
    listVenues({ cityId: city.id, types: ["CLUB", "DISCO"], sort: "popular", limit: 12 }),
  ]);
  const nothing = !upcoming.items.length;

  return (
    <div>
      <HomeMap config={getMapConfig()} places={places} center={{ lat: city.lat, lng: city.lng }} cityName={city.name} />

      <div className="mx-auto max-w-7xl space-y-12 px-4 pt-2 pb-12 md:px-6">
        {nothing ? (
          <EmptyState title="Aún no hay eventos anunciados" icon={<Sparkles className="size-5" />}>
            Los eventos de {city.name} aparecen aquí en cuanto se publican.
          </EmptyState>
        ) : (
          <>
            <EventRail title="Para ti" items={forYou} />
            <EventRail title="Esta noche" items={tonight.items} href="/events?when=today" big />
            <EventRail title="Destacados" items={featured.items} />
            <EventRail title="Este fin de semana" items={weekend.items} href="/events?when=weekend" />
            <section>
              <Header title="Cerca de ti" />
              <NearbyEvents citySlug={city.slug} />
            </section>
            <EventRail title="Festivales" items={festivals.items} href="/events?tipo=festivales" />
            <EventRail title="Tendencia esta semana" items={popular.items} href="/events?when=week" />
            <EventRail title="Recién anunciados" items={newest.items} />
            <section>
              <Header title="Próximamente" href="/events" />
              <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {upcoming.items.map((e, i) => <TicketCard key={e.id} event={e} priority={i < 2} />)}
              </div>
            </section>
          </>
        )}
        {clubs.items.length > 0 && (
          <section>
            <Header title="Clubs y discotecas" href="/map" />
            <Rail itemClassName="w-[70vw] sm:w-[260px]">{clubs.items.map((v) => <VenueCard key={v.id} venue={v} />)}</Rail>
          </section>
        )}
      </div>
    </div>
  );
}

function EventRail({ title, items, href, big }: { title: string; items: EventCardData[]; href?: string; big?: boolean }) {
  if (!items.length) return null;
  return (
    <section>
      <Header title={title} href={href} />
      <Rail itemClassName={big ? "w-[80vw] sm:w-[320px]" : "w-[70vw] sm:w-[260px]"}>{items.map((e) => <EventCard key={e.id} event={e} />)}</Rail>
    </section>
  );
}

function Header({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <h2 className="font-display text-[24px] font-bold tracking-tight md:text-[28px]">{title}</h2>
      {href && (
        <Link href={href} className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
          Ver todo <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
