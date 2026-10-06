"use client";

import { useEffect, useState } from "react";
import { Loader2, LocateFixed } from "lucide-react";
import { EventCard } from "@/components/events/event-card";
import { Rail } from "@/components/ui/rail";
import { useLocation } from "@/components/providers/location-provider";
import { api, reviveDates } from "@/lib/api-client";
import type { EventCardData, Page } from "@/lib/types";

/** "Cerca de ti": only with a location the user chose to share; never asked on load. */
export function NearbyEvents({ citySlug }: { citySlug: string }) {
  const { coords, status, request } = useLocation();
  const [items, setItems] = useState<EventCardData[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    api
      .get<Page<EventCardData>>(`/api/events?city=${citySlug}&lat=${coords.lat}&lng=${coords.lng}&radius=3&limit=10`)
      .then((p) => !cancelled && setItems(reviveDates(p).items))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [coords, citySlug]);

  if (!coords) {
    return (
      <button onClick={request} disabled={status === "locating"} className="pressable flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-sm font-semibold text-muted hover:text-fg">
        {status === "locating" ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
        {status === "denied" ? "Ubicación no permitida: actívala en el navegador para ver lo que hay cerca" : "Ver eventos cerca de mí"}
      </button>
    );
  }
  if (failed) return <p className="text-sm text-muted">No hemos podido cargar los eventos cercanos. Inténtalo de nuevo en un momento.</p>;
  if (!items) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  if (!items.length) return <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No hemos encontrado eventos a menos de 3 km. Prueba en el mapa.</p>;
  return <Rail itemClassName="w-[70vw] sm:w-[260px]">{items.map((e) => <EventCard key={e.id} event={e} />)}</Rail>;
}
