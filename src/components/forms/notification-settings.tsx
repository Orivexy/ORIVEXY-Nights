"use client";

import { useState } from "react";
import { useToast } from "@/components/providers/toast-provider";
import { api, ApiClientError } from "@/lib/api-client";
import { MUTABLE_NOTIFICATIONS } from "@/config/taxonomy";

/** On/off switch per optional notification kind; saved at once. */
export function NotificationSettings({ initialMuted }: { initialMuted: string[] }) {
  const [muted, setMuted] = useState(new Set(initialMuted));
  const toast = useToast();
  const toggle = async (kind: string) => {
    const next = new Set(muted);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    const prev = muted;
    setMuted(next);
    try {
      await api.put("/api/me/notification-settings", { muted: [...next] });
    } catch (err) {
      setMuted(prev);
      toast((err as ApiClientError).message, "error");
    }
  };
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
      {MUTABLE_NOTIFICATIONS.map((n) => {
        const on = !muted.has(n.value);
        return (
          <li key={n.value}>
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-[14px]">
              <span>{n.label}</span>
              <input type="checkbox" role="switch" checked={on} onChange={() => void toggle(n.value)} className="size-5 accent-[var(--color-volt)]" />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
