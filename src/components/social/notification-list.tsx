"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, CalendarClock, CalendarPlus, CheckCircle2, Heart, Loader2, MessageCircle, Tag, UserPlus, XCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { useInfinite } from "@/hooks/use-infinite";
import { imageUrl } from "@/lib/media";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";
import type { NotificationData, Page } from "@/lib/types";

function describe(n: NotificationData): { icon: React.ReactNode; text: React.ReactNode; href: string } {
  const who = <b>{n.actor?.displayName ?? "Alguien"}</b>;
  const post = n.post ? `/social?post=${n.post.id}` : "/";
  const event = n.event ? `/events/${n.event.slug}` : "/";
  switch (n.type) {
    case "FOLLOW":
      return { icon: <UserPlus className="size-3.5" />, text: <>{who} empezó a seguirte.</>, href: n.actor ? `/u/${n.actor.username}` : "/" };
    case "POST_LIKE":
      return { icon: <Heart className="size-3.5" fill="currentColor" />, text: <>A {who} le ha gustado tu publicación.</>, href: post };
    case "POST_COMMENT":
      return { icon: <MessageCircle className="size-3.5" />, text: <>{who} comentó tu publicación{n.comment ? `: “${n.comment.body}”` : "."}</>, href: post };
    case "POST_TAG":
      return { icon: <Tag className="size-3.5" />, text: <>{who} te ha etiquetado en una publicación.</>, href: post };
    case "EVENT_REMINDER":
      return { icon: <CalendarClock className="size-3.5" />, text: <>Tu evento <b>{n.event?.title}</b> empieza en menos de 2 horas.</>, href: event };
    case "VENUE_NEW_EVENT":
      return { icon: <CalendarPlus className="size-3.5" />, text: <>Hay un nuevo evento en un local que sigues: <b>{n.event?.title}</b>.</>, href: event };
    case "ARTIST_NEW_EVENT":
      return { icon: <CalendarPlus className="size-3.5" />, text: <>Un artista que sigues tiene nueva fecha: <b>{n.event?.title}</b>.</>, href: event };
    case "EVENT_APPROVED":
      return { icon: <CheckCircle2 className="size-3.5" />, text: <>Tu evento <b>{n.event?.title}</b> ha sido aprobado y ya es público.</>, href: event };
    case "EVENT_REJECTED":
      return { icon: <XCircle className="size-3.5" />, text: <>Tu evento <b>{n.event?.title}</b> no ha sido aprobado. Revísalo y vuelve a enviarlo.</>, href: event };
    case "BUSINESS_APPROVED":
      return { icon: <BadgeCheck className="size-3.5" />, text: <>Tu cuenta de organizador/local ha sido <b>verificada</b>. Ya puedes publicar eventos oficiales.</>, href: "/business" };
    case "BUSINESS_REJECTED":
      return { icon: <XCircle className="size-3.5" />, text: <>Tu solicitud de cuenta de organizador/local no ha sido aprobada. Mira el motivo.</>, href: "/business" };
    default:
      return { icon: <AlertTriangle className="size-3.5" />, text: <>Parte de tu contenido ha sido retirado por incumplir las normas.</>, href: "/" };
  }
}

export function NotificationList({ initial }: { initial: Page<NotificationData> }) {
  const { items, sentinel, loading } = useInfinite(initial, (c) => `/api/notifications?cursor=${c}`);

  useEffect(() => {
    if (initial.items.some((n) => !n.read)) void fetch("/api/notifications/read", { method: "POST" });
  }, [initial]);

  if (!items.length) return <EmptyState title="Todo tranquilo por aquí">Cuando alguien te siga, comente o un evento esté a punto de empezar, lo verás aquí.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const d = describe(n);
        const thumb = n.post?.thumbKey ?? n.event?.coverKey ?? null;
        return (
          <li key={n.id}>
            <Link href={d.href} className={cn("-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-surface", !n.read && "bg-volt/[0.04]")}>
              <div className="relative">
                {n.actor ? <Avatar user={n.actor} size={46} /> : <span className="grid size-[46px] place-items-center rounded-full bg-surface-2 text-volt">{d.icon}</span>}
                {n.actor && <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-volt text-on-volt ring-2 ring-ink">{d.icon}</span>}
              </div>
              <p className="min-w-0 flex-1 text-[14px] leading-snug">
                {d.text} <span className="text-faint">{timeAgo(n.createdAt)}</span>
              </p>
              {thumb && (
                <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  <Image src={imageUrl(thumb, "sm")!} alt="" fill sizes="48px" className="object-cover" />
                </span>
              )}
              {!n.read && <span className="size-2 shrink-0 rounded-full bg-volt" aria-label="Sin leer" />}
            </Link>
          </li>
        );
      })}
      <div ref={sentinel} className="flex justify-center py-4">{loading && <Loader2 className="size-5 animate-spin text-muted" />}</div>
    </ul>
  );
}
