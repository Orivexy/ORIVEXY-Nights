"use client";

import { useState } from "react";
import { Bookmark, Check, Star } from "lucide-react";
import { useRequireAuth } from "@/components/providers/auth-gate";
import { useToast } from "@/components/providers/toast-provider";
import { ShareButton } from "@/components/social/share-button";
import { api, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Attendance = "INTERESTED" | "GOING" | null;

interface Props {
  eventId: string;
  slug: string;
  title: string;
  initial: { attendance: Attendance; saved: boolean; interestedCount: number; goingCount: number };
  disabled?: boolean;
}

/** ME INTERESA / VOY / GUARDAR / COMPARTIR with optimistic updates. */
export function EventActions({ eventId, slug, title, initial, disabled }: Props) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const requireAuth = useRequireAuth();
  const toast = useToast();

  const setAttendance = async (next: Attendance) => {
    if (!requireAuth("Inicia sesión para decir que vas o te interesa")) return;
    const prev = state;
    const target = state.attendance === next ? null : next;
    // Optimistic counter update
    const delta = { INTERESTED: 0, GOING: 0 };
    if (prev.attendance) delta[prev.attendance] -= 1;
    if (target) delta[target] += 1;
    setState({ ...prev, attendance: target, interestedCount: prev.interestedCount + delta.INTERESTED, goingCount: prev.goingCount + delta.GOING });
    setBusy(true);
    try {
      const res = await api.put<{ interestedCount: number; goingCount: number }>(`/api/events/${eventId}/attendance`, { status: target });
      setState((s) => ({ ...s, ...res }));
      if (target === "GOING") toast("¡Genial! Te recordaremos antes de que empiece.");
    } catch (err) {
      setState(prev);
      toast((err as ApiClientError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleSave = async () => {
    if (!requireAuth("Inicia sesión para guardar eventos")) return;
    const saved = !state.saved;
    setState((s) => ({ ...s, saved }));
    try {
      await api.put(`/api/events/${eventId}/save`, { saved });
      toast(saved ? "Guardado en tus planes" : "Eliminado de guardados", "info");
    } catch (err) {
      setState((s) => ({ ...s, saved: !saved }));
      toast((err as ApiClientError).message, "error");
    }
  };

  const base = "pressable flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-bold tracking-wide uppercase disabled:opacity-50";
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button disabled={busy || disabled} onClick={() => setAttendance("INTERESTED")} aria-pressed={state.attendance === "INTERESTED"} className={cn(base, state.attendance === "INTERESTED" ? "bg-fg text-ink" : "border border-line-strong bg-surface hover:bg-surface-2")}>
          <Star className="size-4" fill={state.attendance === "INTERESTED" ? "currentColor" : "none"} /> Me interesa
        </button>
        <button disabled={busy || disabled} onClick={() => setAttendance("GOING")} aria-pressed={state.attendance === "GOING"} className={cn(base, state.attendance === "GOING" ? "bg-volt text-on-volt" : "bg-volt/90 text-on-volt hover:bg-volt")}>
          <Check className="size-4" strokeWidth={3} /> {state.attendance === "GOING" ? "Vas" : "Voy"}
        </button>
      </div>
      <div className="flex gap-2">
        <button onClick={toggleSave} aria-pressed={state.saved} className={cn("pressable flex h-11 flex-1 items-center justify-center gap-2 rounded-full border text-sm font-semibold", state.saved ? "border-volt/50 text-volt" : "border-line-strong hover:bg-surface-2")}>
          <Bookmark className="size-[18px]" fill={state.saved ? "currentColor" : "none"} /> {state.saved ? "Guardado" : "Guardar"}
        </button>
        <ShareButton url={`/events/${slug}`} title={title} target={{ eventId }} className="h-11 flex-1 rounded-full border border-line-strong text-sm hover:bg-surface-2" />
      </div>
      <p className="text-center text-[13px] text-muted">
        <span className="font-bold text-fg">{state.goingCount}</span> van · <span className="font-bold text-fg">{state.interestedCount}</span> interesados
      </p>
    </div>
  );
}
