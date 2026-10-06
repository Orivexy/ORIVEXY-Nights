"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { FollowButton } from "@/components/social/follow-button";
import { ShareButton } from "@/components/social/share-button";
import { MoreMenu } from "@/components/social/more-menu";
import { useReport } from "@/components/social/report-dialog";
import { compactNumber } from "@/lib/text";

export function VenueActions({ venueId, slug, name, following, followerCount }: { venueId: string; slug: string; name: string; following: boolean; followerCount: number }) {
  const [count, setCount] = useState(followerCount);
  const report = useReport();
  return (
    <div className="flex items-center gap-2">
      <FollowButton kind="venue" targetId={venueId} initial={following} onChange={(_, c) => c != null && setCount(c)} className="flex-1 md:flex-none" />
      <ShareButton url={`/venues/${slug}`} title={name} target={{ venueId }} iconOnly className="size-10 rounded-full border border-line-strong hover:bg-surface-2" />
      <MoreMenu items={[{ label: "Reportar local", icon: <Flag className="size-4" />, onSelect: () => report.open("VENUE", venueId) }]} className="border border-line-strong" />
      <span className="ml-1 text-[13px] text-muted">
        <b className="text-fg">{compactNumber(count)}</b> seguidores
      </span>
      {report.dialog}
    </div>
  );
}
