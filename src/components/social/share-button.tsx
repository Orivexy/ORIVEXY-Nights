"use client";

import { Share2 } from "lucide-react";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/cn";

/** Counts a share or ticket click (internal metric; failures are ignored). */
export function track(type: "SHARE" | "TICKET_CLICK", target: { eventId?: string; venueId?: string }) {
  void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...target }), keepalive: true }).catch(() => {});
}

export async function shareLink(url: string, title: string, toast: (m: string, k?: "success" | "error" | "info") => void, target?: { eventId?: string; venueId?: string }) {
  const absolute = new URL(url, window.location.origin).toString();
  if (target) track("SHARE", target);
  if (navigator.share) {
    try {
      await navigator.share({ title, url: absolute });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(absolute);
    toast("Enlace copiado");
  } catch {
    toast("No se pudo copiar el enlace", "error");
  }
}

export function ShareButton({ url, title, className, label = "Compartir", iconOnly, target }: { url: string; title: string; className?: string; label?: string; iconOnly?: boolean; target?: { eventId?: string; venueId?: string } }) {
  const toast = useToast();
  return (
    <button onClick={() => shareLink(url, title, toast, target)} aria-label={label} className={cn("pressable inline-flex items-center justify-center gap-2 font-semibold", className)}>
      <Share2 className="size-[18px]" />
      {!iconOnly && label}
    </button>
  );
}
