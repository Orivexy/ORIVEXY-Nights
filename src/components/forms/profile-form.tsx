"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/misc";
import { GENRES } from "@/config/taxonomy";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/providers/toast-provider";
import { useUpload, type UploadedImage } from "@/hooks/use-upload";
import { api, ApiClientError } from "@/lib/api-client";

interface Props {
  initial: { username: string; displayName: string; bio: string; avatarKey: string | null; citySlug: string; favoriteGenres: string[] };
  cities: Array<{ slug: string; name: string }>;
  email: string;
}

export function ProfileForm({ initial, cities, email }: Props) {
  const [v, setV] = useState(initial);
  const [avatarPhotoId, setAvatarPhotoId] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { upload } = useUpload();
  const toast = useToast();
  const router = useRouter();

  const onAvatar = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const img = await upload<UploadedImage>(files[0], "avatar");
      setAvatarPhotoId(img.id);
      setV((s) => ({ ...s, avatarKey: img.key }));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const { profile } = await api.patch<{ profile: { username: string } }>("/api/me/profile", {
        username: v.username,
        displayName: v.displayName,
        bio: v.bio.trim() || null,
        citySlug: v.citySlug,
        favoriteGenres: v.favoriteGenres,
        ...(avatarPhotoId ? { avatarPhotoId } : {}),
      });
      toast("Perfil actualizado");
      router.push(`/u/${profile.username}`);
      router.refresh();
    } catch (err) {
      const e = err as ApiClientError;
      setErrors(e.fields ?? {});
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => input.current?.click()} className="group relative" aria-label="Cambiar foto de perfil">
          <Avatar user={{ displayName: v.displayName, avatarKey: v.avatarKey }} size={88} />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          </span>
        </button>
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()} loading={uploading}>
            Cambiar foto
          </Button>
          <p className="mt-1 text-[12px] text-faint">{email}</p>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onAvatar(e.target.files)} />
      </div>

      <Field label="Nombre" htmlFor="dn" error={errors.displayName}>
        <Input id="dn" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} maxLength={50} required />
      </Field>
      <Field label="Usuario" htmlFor="un" error={errors.username} hint="Letras, números, punto y guion bajo">
        <Input id="un" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} maxLength={24} required />
      </Field>
      <Field label="Biografía" htmlFor="bio" error={errors.bio}>
        <Textarea id="bio" value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} maxLength={200} placeholder="Barcelona nightlife" className="min-h-20" />
      </Field>
      <Field label="Ciudad" htmlFor="city">
        <Select id="city" value={v.citySlug} onChange={(e) => setV({ ...v, citySlug: e.target.value })}>
          {cities.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Música que te gusta" hint="Para recomendarte eventos">
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => {
            const on = v.favoriteGenres.includes(g.slug);
            return (
              <Chip key={g.slug} active={on} onClick={() => setV({ ...v, favoriteGenres: on ? v.favoriteGenres.filter((x) => x !== g.slug) : [...v.favoriteGenres, g.slug].slice(0, 8) })}>
                {g.name}
              </Chip>
            );
          })}
        </div>
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={saving} disabled={uploading}>
        Guardar
      </Button>
    </form>
  );
}
