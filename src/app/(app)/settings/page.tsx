import { site } from "@/config/site";
import type { Metadata } from "next";
import { NotificationSettings } from "@/components/forms/notification-settings";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listCities } from "@/server/services/cities";
import { ProfileForm } from "@/components/forms/profile-form";
import { BackButton } from "@/components/events/event-header-actions";
import { AccountSettings } from "@/components/forms/account-settings";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listBlocked } from "@/server/services/blocks";
import { BlockedList } from "@/components/social/blocked-list";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings");
  const [profile, cities, blocked] = await Promise.all([
    db.profile.findUniqueOrThrow({ where: { userId: user.id }, select: { bio: true, favoriteGenres: true, city: { select: { slug: true } }, user: { select: { passwordHash: true, mutedNotifications: true } } } }),
    listCities(),
    listBlocked(user.id),
  ]);
  return (
    <div className="mx-auto max-w-lg px-4 pt-4 pb-16 md:pt-10">
      <div className="mb-6 flex items-center gap-3">
        <BackButton className="pressable grid size-10 place-items-center rounded-full hover:bg-surface-2" />
        <h1 className="font-display text-2xl font-bold">Ajustes</h1>
      </div>
      <ProfileForm
        email={user.email}
        cities={cities.map((c) => ({ slug: c.slug, name: c.name }))}
        initial={{ username: user.username, displayName: user.displayName, bio: profile.bio ?? "", avatarKey: user.avatarKey, citySlug: profile.city?.slug ?? site.defaultCitySlug, favoriteGenres: profile.favoriteGenres }}
      />
      <div className="my-10 h-px bg-line" />
      <Link href="/business" className="mb-10 flex items-center justify-between rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
        <span>
          <span className="block font-semibold">¿Organizas fiestas o gestionas un local?</span>
          <span className="block text-sm text-muted">Pide una cuenta de organizador o de local para publicar como oficial.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted" />
      </Link>
      <section className="mb-10 space-y-3">
        <h2 className="text-[13px] font-bold tracking-wider text-muted uppercase">Notificaciones</h2>
        <NotificationSettings initialMuted={profile.user.mutedNotifications} />
      </section>
      <section className="mb-10 space-y-3">
        <h2 className="text-[13px] font-bold tracking-wider text-muted uppercase">Usuarios bloqueados</h2>
        <BlockedList initial={blocked} />
      </section>
      <AccountSettings username={user.username} hasPassword={Boolean(profile.user.passwordHash)} />
    </div>
  );
}
