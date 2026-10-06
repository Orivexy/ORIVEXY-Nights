"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, LocateFixed, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MapView } from "@/components/map/map-view";
import { AddressSearch } from "@/components/map/address-search";
import { useLocation } from "@/components/providers/location-provider";
import { useToast } from "@/components/providers/toast-provider";
import { useUpload, type UploadedImage } from "@/hooks/use-upload";
import { api, ApiClientError } from "@/lib/api-client";
import { imageUrl } from "@/lib/media";
import { CATEGORIES, GENRES } from "@/config/taxonomy";
import type { MapConfig } from "@/server/services/map";

export interface VenueOption {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
}

export interface EventFormValues {
  title: string;
  description: string;
  category: string;
  genres: string[];
  venueId: string | null;
  locationName: string;
  address: string;
  lat: number;
  lng: number;
  date: string;
  startTime: string;
  endTime: string;
  isFree: boolean;
  price: string;
  minAge: string;
  ticketUrl: string;
  /** Line-up, comma separated. */
  artists: string;
  cover: { id: string; key: string } | null;
}

interface Props {
  mode: "create" | "edit";
  eventId?: string;
  citySlug: string;
  cityName: string;
  venues: VenueOption[];
  mapConfig: MapConfig;
  initial: EventFormValues;
  moderationNotice: boolean;
  /** Editing a draft: saving keeps it a draft. */
  isDraft?: boolean;
}

export function EventForm({ mode, eventId, citySlug, cityName, venues, mapConfig, initial, moderationNotice, isDraft = false }: Props) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload, progress } = useUpload();
  const { coords, request } = useLocation();
  const toast = useToast();
  const router = useRouter();
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setV((s) => ({ ...s, [key]: value }));
  const venue = venues.find((x) => x.id === v.venueId) ?? null;

  const pickVenue = (id: string) => {
    const found = venues.find((x) => x.id === id);
    setV((s) => (found ? { ...s, venueId: id, locationName: found.name, address: found.address, lat: found.lat, lng: found.lng } : { ...s, venueId: null }));
  };

  const onCover = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const img = await upload<UploadedImage>(files[0], "image");
      set("cover", { id: img.id, key: img.key });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };

  // New events are saved as a draft and published from their preview page.
  const asDraft = mode === "create" || isDraft;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = {
      title: v.title,
      description: v.description || undefined,
      category: v.category,
      genres: v.genres,
      citySlug,
      venueId: v.venueId,
      locationName: v.locationName,
      address: v.address || undefined,
      lat: v.lat,
      lng: v.lng,
      date: v.date,
      startTime: v.startTime,
      endTime: v.endTime || null,
      isFree: v.isFree,
      price: v.isFree ? null : Number(v.price.replace(",", ".")),
      minAge: v.minAge ? Number(v.minAge) : null,
      ticketUrl: v.ticketUrl || null,
      coverPhotoId: v.cover?.id ?? null,
      photoIds: v.cover ? [v.cover.id] : [],
      artists: v.artists.split(",").map((a) => a.trim()).filter(Boolean),
      draft: asDraft,
    };
    try {
      const res = mode === "create" ? await api.post<{ slug: string; status: string }>("/api/events", body) : await api.patch<{ slug: string; status: string }>(`/api/events/${eventId}`, body);
      toast(res.status === "DRAFT" ? "Borrador guardado: revisa la vista previa y publícalo" : res.status === "PENDING" ? "Enviado a revisión. Te avisaremos cuando se publique." : "Cambios guardados");
      router.push(`/events/${res.slug}`);
      router.refresh();
    } catch (err) {
      const e = err as ApiClientError;
      setErrors(e.fields ?? {});
      toast(e.message, "error");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-7" noValidate>
      {/* Cover */}
      <div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => onCover(e.target.files)} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="relative flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface text-muted hover:bg-surface-2">
          {v.cover ? (
            <Image src={imageUrl(v.cover.key, "lg")!} alt="Portada" fill sizes="600px" className="object-cover" />
          ) : uploading ? (
            <>
              <Loader2 className="size-6 animate-spin text-volt" /> <span className="text-sm">{progress ?? 0}%</span>
            </>
          ) : (
            <>
              <ImagePlus className="size-7" />
              <span className="font-semibold text-fg">Añadir imagen principal</span>
              <span className="text-[13px]">Cartel o foto del sitio</span>
            </>
          )}
          {v.cover && (
            <span className="glass absolute right-3 bottom-3 rounded-full px-3 py-1.5 text-[13px] font-semibold text-fg">Cambiar imagen</span>
          )}
        </button>
      </div>

      <Field label="Título" htmlFor="title" error={errors.title}>
        <Input id="title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={80} placeholder="TECHNO NIGHT" required />
      </Field>

      <Field label="Categoría" error={errors.category}>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c.slug} active={v.category === c.slug} onClick={() => set("category", c.slug)}>
              {c.emoji} {c.name}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Música" hint="Hasta 4 estilos" error={errors.genres}>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => {
            const on = v.genres.includes(g.slug);
            return (
              <Chip key={g.slug} active={on} onClick={() => set("genres", on ? v.genres.filter((x) => x !== g.slug) : v.genres.length < 4 ? [...v.genres, g.slug] : v.genres)}>
                {g.name}
              </Chip>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Fecha" htmlFor="date" error={errors.date} className="col-span-2 sm:col-span-1">
          <Input id="date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} required />
        </Field>
        <Field label="Empieza" htmlFor="start" error={errors.startTime}>
          <Input id="start" type="time" value={v.startTime} onChange={(e) => set("startTime", e.target.value)} required />
        </Field>
        <Field label="Termina" htmlFor="end" error={errors.endTime}>
          <Input id="end" type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </Field>
      </div>

      {/* Location */}
      <section className="space-y-3">
        <Field label={`Lugar en ${cityName}`} htmlFor="venue">
          <Select id="venue" value={v.venueId ?? ""} onChange={(e) => pickVenue(e.target.value)}>
            <option value="">Otro sitio (calle, plaza, casa…)</option>
            {venues.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} {x.neighborhood ? `· ${x.neighborhood}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {!venue && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre del lugar" htmlFor="loc" error={errors.locationName}>
                <Input id="loc" value={v.locationName} onChange={(e) => set("locationName", e.target.value)} maxLength={80} placeholder="Plaça del Sol" />
              </Field>
              <Field label="Dirección" htmlFor="addr" error={errors.address}>
                <Input id="addr" value={v.address} onChange={(e) => set("address", e.target.value)} maxLength={160} placeholder="Gràcia, Barcelona" />
              </Field>
            </div>
            <AddressSearch
              citySlug={citySlug}
              onPick={(r) => setV((s) => ({ ...s, lat: r.lat, lng: r.lng, address: s.address || r.label.split(",").slice(0, 3).join(",").slice(0, 160) }))}
            />
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="relative h-56">
                <MapView
                  config={mapConfig}
                  center={{ lat: v.lat, lng: v.lng }}
                  zoom={14}
                  markers={[{ id: "pin", lat: v.lat, lng: v.lng, variant: v.category }]}
                  onMapClick={(p) => setV((s) => ({ ...s, lat: p.lat, lng: p.lng }))}
                  user={coords}
                  className="size-full"
                />
              </div>
              <div className="flex items-center justify-between gap-2 bg-surface px-4 py-2.5 text-[13px] text-muted">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" /> Toca el mapa para situar el evento
                </span>
                <button type="button" onClick={() => (coords ? setV((s) => ({ ...s, lat: coords.lat, lng: coords.lng })) : request())} className="flex items-center gap-1 font-semibold text-fg">
                  <LocateFixed className="size-4" /> Aquí
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <Field label="Entrada" error={errors.price}>
        <div className="flex flex-wrap items-center gap-3">
          <Chip active={v.isFree} onClick={() => set("isFree", true)}>Gratis</Chip>
          <Chip active={!v.isFree} onClick={() => set("isFree", false)}>De pago</Chip>
          {!v.isFree && (
            <div className="relative w-36">
              <Input inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="15" aria-label="Precio en euros" className="pr-9" />
              <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted">€</span>
            </div>
          )}
        </div>
        {!v.isFree && (
          <p className="text-[12px] text-faint">
            La venta de entradas dentro de (Nombre en proceso) todavía no está disponible. Indica el precio y, si quieres, un enlace de venta externo.
          </p>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Edad mínima" htmlFor="age">
          <Select id="age" value={v.minAge} onChange={(e) => set("minAge", e.target.value)}>
            <option value="">Todas las edades</option>
            <option value="16">+16</option>
            <option value="18">+18</option>
            <option value="21">+21</option>
          </Select>
        </Field>
        <Field label="Entradas (enlace)" htmlFor="tix" error={errors.ticketUrl}>
          <Input id="tix" type="url" value={v.ticketUrl} onChange={(e) => set("ticketUrl", e.target.value)} placeholder="https://…" />
        </Field>
      </div>

      <Field label="Artistas / DJs" htmlFor="artists" hint="Separados por comas, en orden de cartel" error={errors.artists}>
        <Input id="artists" value={v.artists} onChange={(e) => set("artists", e.target.value)} maxLength={600} placeholder="Nombre del DJ, otra artista…" />
      </Field>

      <Field label="Descripción" htmlFor="desc" error={errors.description}>
        <Textarea id="desc" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} placeholder="Fiesta abierta en Gràcia. DJs locales, barras del barrio…" />
      </Field>

      {moderationNotice && mode === "create" && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted">Las cuentas nuevas pasan una revisión rápida antes de publicar eventos. Normalmente tarda poco.</p>
      )}

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button type="submit" size="lg" className="w-full shadow-2xl shadow-black" loading={saving} disabled={uploading}>
          {asDraft ? "Guardar y ver vista previa" : "Guardar cambios"}
        </Button>
      </div>
      {v.cover && (
        <button type="button" onClick={() => set("cover", null)} className="flex items-center gap-1 text-sm text-muted">
          <X className="size-4" /> Quitar imagen
        </button>
      )}
    </form>
  );
}
