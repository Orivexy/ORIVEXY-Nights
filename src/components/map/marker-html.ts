import type { MapMarker } from "./types";

/** ORIVEXY NIGHTS markers and clusters as HTML, shared by every renderer. */
const GLYPH: Record<string, string> = { fm: "🎪", fiesta: "🎉", festival: "🎡", concierto: "🎤", dj: "🎧", discoteca: "🪩", evento: "✨", otro: "✨" };
export const isPlace = (v: string) => v === "club" || v === "venue";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function markerHtml(m: MapMarker, selected: boolean) {
  const place = isPlace(m.variant);
  const cls = ["nx-pin", place ? "nx-pin-place" : "nx-pin-event", m.open ? "is-open" : "", m.live ? "is-live" : "", selected ? "is-selected" : ""].join(" ");
  const core = place
    ? '<span class="nx-pin-core"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="7" width="2.4" height="5" rx="1.2"/><rect x="6.8" y="4" width="2.4" height="8" rx="1.2"/><rect x="11.6" y="6" width="2.4" height="6" rx="1.2"/></svg></span>'
    : `<span class="nx-pin-core">${GLYPH[m.variant] ?? "🎉"}</span>`;
  const label = selected && m.label ? `<span class="nx-pin-label">${escapeHtml(m.label)}</span>` : "";
  return `<div class="${cls}">${core}${label}</div>`;
}

export function clusterHtml(count: number, live: boolean) {
  const size = count < 10 ? 38 : count < 50 ? 46 : 56;
  return {
    size,
    html: `<div class="nx-cluster${live ? " is-live" : ""}" style="width:${size}px;height:${size}px"><span>${count > 999 ? "999+" : count}</span></div>`,
  };
}

