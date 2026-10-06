import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";

/**
 * Crescent moon + equalizer (night + party) and a two-line wordmark
 * (first word / the rest) so it fits phone headers.
 * Source of the mark: scripts/logo.mjs → public/icons/logo-mark.svg
 */
export function Logo({ className }: { className?: string }) {
  // A provisional name "ORIVEXY NIGHTS" is shown as "Nombre / en proceso", like a real wordmark.
  const [first, ...rest] = site.name.replace(/^\((.*)\)$/, "$1").split(" ");
  return (
    <Link href="/" className={cn("group inline-flex shrink-0 items-center gap-1.5 font-display text-[19px] font-bold tracking-tight", className)} aria-label={`${site.name} — inicio`}>
      <Image src="/icons/logo-mark.svg" alt="" width={26} height={26} unoptimized priority className="-my-1 size-[26px] transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" />
      <span className="flex flex-col leading-none">
        <span>{first}</span>
        {rest.length > 0 && <span className="mt-0.5 text-[0.47em] font-semibold tracking-[0.42em] text-volt">{rest.join(" ")}</span>}
      </span>
    </Link>
  );
}
