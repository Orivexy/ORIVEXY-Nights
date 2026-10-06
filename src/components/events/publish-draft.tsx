"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/providers/toast-provider";
import { api, ApiClientError } from "@/lib/api-client";

/** Preview of a draft: publish it (or send it to review) once it looks right. */
export function PublishDraft({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const publish = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ status: string }>(`/api/events/${eventId}/submit`, {});
      toast(res.status === "PENDING" ? "Enviado a revisión. Te avisaremos cuando se publique." : "¡Evento publicado!");
      router.refresh();
    } catch (err) {
      toast((err as ApiClientError).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" onClick={publish} loading={busy}>
      Publicar
    </Button>
  );
}
