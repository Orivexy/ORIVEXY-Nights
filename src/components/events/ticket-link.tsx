"use client";

import { track } from "@/components/social/share-button";

/** External ticket / official link that counts the click (internal metric). */
export function TicketLink({ eventId, href, className, children }: { eventId: string; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className} onClick={() => track("TICKET_CLICK", { eventId })}>
      {children}
    </a>
  );
}
