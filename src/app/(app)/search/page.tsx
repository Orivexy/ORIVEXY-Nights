import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, SearchX } from "lucide-react";
import { SearchBox } from "@/components/forms/search-box";
import { EventRow } from "@/components/events/event-card";
import { VenueCard } from "@/components/venues/venue-card";
import { UserRow } from "@/components/social/user-row";
import { EmptyState, SectionHeader } from "@/components/ui/misc";
import { Rail } from "@/components/ui/rail";
import { getCurrentCity } from "@/server/services/cities";
import { globalSearch } from "@/server/services/search";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { GENRES } from "@/config/taxonomy";

export const metadata: Metadata = { title: "Buscar" };

const SUGGESTIONS = ["Gràcia", "Poblenou", "Techno", "Reggaeton", "Gratis", "House", "Razzmatazz", "Apolo"];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; lat?: string; lng?: string }> }) {
  const { q = "", lat, lng } = await searchParams;
  const [city, user] = await Promise.all([getCurrentCity(), getSessionUser()]);
  const coords = lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null;
  const results = q.trim() ? await globalSearch(q, city, { limit: 8, coords }) : null;
  const chips = results ? intentChips(results) : [];
  const followed = user && results?.users.length
    ? new Set((await db.follow.findMany({ where: { followerId: user.id, followingId: { in: results.users.map((u) => u.id) } }, select: { followingId: true } })).map((f) => f.followingId))
    : new Set<string>();
  const empty = results && !results.events.length && !results.venues.length && !results.users.length && !results.places.length && !results.artists.length;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 pt-5 md:pt-10">
      <SearchBox initial={q} />

      {!results && (
        <section>
          <p className="mb-3 text-[13px] font-bold tracking-wider text-muted uppercase">Prueba con</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Link key={s} href={`/search?q=${encodeURIComponent(s)}`} className="pressable rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-surface-2">
                {s}
              </Link>
            ))}
          </div>
        </section>
      )}

      {chips.length > 0 && (
        <div className="-mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Buscando:</span>
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-surface-2 px-3 py-1 font-semibold">
              {c}
            </span>
          ))}
          <Link href={`/map?q=${encodeURIComponent(q)}`} className="ml-auto flex items-center gap-1 font-semibold text-volt">
            <MapPin className="size-3.5" /> Ver en el mapa
          </Link>
        </div>
      )}
      {results?.needsLocation && <p className="-mt-4 text-[13px] text-muted">Para «cerca de mí», permite la ubicación con el botón de ubicación del buscador.</p>}

      {empty && (
        <EmptyState icon={<SearchX className="size-5" />} title={`Nada para “${q}”`}>
          Prueba con un barrio, un estilo de música o el nombre de un local en {city.name}.
        </EmptyState>
      )}

      {results?.places.length ? (
        <section>
          <SectionHeader title="Zonas" />
          <div className="flex flex-wrap gap-2">
            {results.places.map((p) => (
              <Link key={p.name} href={`/search?q=${encodeURIComponent(p.name)}`} className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-surface-2">
                <MapPin className="size-4 text-volt" />
                <span className="font-semibold">{p.name}</span>
                <span className="text-[13px] text-muted">{p.count} locales</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {results?.events.length ? (
        <section>
          <SectionHeader title={`Eventos${results.places.length ? ` en ${results.places[0]!.name}` : ""}`} />
          <div className="divide-y divide-line">
            {results.events.map((e) => (
              <div key={e.id} className="py-1">
                <EventRow event={e} showDay />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {results?.venues.length ? (
        <section>
          <SectionHeader title="Discotecas y locales" />
          <Rail itemClassName="w-[70vw] sm:w-[260px]">{results.venues.map((v) => <VenueCard key={v.id} venue={v} />)}</Rail>
        </section>
      ) : null}

      {results?.artists.length ? (
        <section>
          <SectionHeader title="Artistas y DJs" />
          <ul className="flex flex-wrap gap-2">
            {results.artists.map((a) => (
              <li key={a.id}>
                <Link href={`/artists/${a.slug}`} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[14px] font-semibold hover:bg-surface-2">
                  {a.name}
                  {a.upcoming > 0 && <span className="text-[12px] font-normal text-muted">{a.upcoming} {a.upcoming === 1 ? "fecha" : "fechas"}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results?.users.length ? (
        <section>
          <SectionHeader title="Personas" />
          <div className="divide-y divide-line">
            {results.users.map((u) => <UserRow key={u.id} user={u} following={followed.has(u.id)} showFollow={u.id !== user?.id} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const WHEN_LABEL: Record<string, string> = { today: "Hoy", tomorrow: "Mañana", weekend: "Este finde", week: "7 días" };
const TYPE_LABEL: Record<string, string> = { discoteca: "Discotecas", club: "Clubs", fiesta: "Fiestas", festival: "Festivales", concierto: "Conciertos", evento: "Eventos" };

function intentChips(r: Awaited<ReturnType<typeof globalSearch>>): string[] {
  const i = r.intent;
  return [
    ...(i.when ? [WHEN_LABEL[i.when]!] : []),
    ...i.types.map((t) => TYPE_LABEL[t] ?? t),
    ...i.genres.map((g) => GENRES.find((x) => x.slug === g)?.name ?? g),
    ...(i.free ? ["Gratis"] : []),
    ...(i.near ? ["Cerca de ti"] : []),
    ...(i.city ? [r.city.name] : []),
    ...(i.text ? [`“${i.text}”`] : []),
  ];
}
