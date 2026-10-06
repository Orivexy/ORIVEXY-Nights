"use client";

import { cn } from "@/lib/cn";

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("scrollbar-none flex gap-1 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "relative flex-1 shrink-0 px-3 py-3 text-[13px] font-bold tracking-wide whitespace-nowrap uppercase transition-colors",
            value === t.value ? "text-fg" : "text-faint hover:text-muted",
          )}
        >
          {t.label}
          {value === t.value && <span className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-volt" />}
        </button>
      ))}
    </div>
  );
}
