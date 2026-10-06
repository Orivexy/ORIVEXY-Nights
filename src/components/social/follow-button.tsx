"use client";

import { useState } from "react";
import { useRequireAuth } from "@/components/providers/auth-gate";
import { useToast } from "@/components/providers/toast-provider";
import { api, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

interface Props {
  /** "user" follows a person, "venue" a club, "artist" a DJ or band. */
  kind?: "user" | "venue" | "artist";
  targetId: string;
  initial: boolean;
  onChange?: (following: boolean, followerCount?: number) => void;
  size?: "sm" | "md";
  className?: string;
}

export function FollowButton({ kind = "user", targetId, initial, onChange, size = "md", className }: Props) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const requireAuth = useRequireAuth();
  const toast = useToast();

  const toggle = async () => {
    if (!requireAuth(kind === "venue" ? "Inicia sesión para seguir locales" : kind === "artist" ? "Inicia sesión para seguir artistas" : "Inicia sesión para seguir a gente")) return;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const url = kind === "user" ? `/api/users/${targetId}/follow` : `/api/${kind === "venue" ? "venues" : "artists"}/${targetId}/follow`;
      const res = await api.put<{ following: boolean; followerCount: number }>(url, { following: next });
      onChange?.(res.following, res.followerCount);
    } catch (err) {
      setFollowing(!next);
      toast((err as ApiClientError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={cn(
        "pressable inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-6 text-sm tracking-wide uppercase",
        following ? "border border-line-strong bg-transparent text-fg hover:bg-surface-2" : "bg-volt text-on-volt hover:bg-volt-dim",
        className,
      )}
    >
      {following ? "Siguiendo" : "Seguir"}
    </button>
  );
}
