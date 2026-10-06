// ORIVEXY NIGHTS logo mark: a neon crescent moon (the night) with equalizer bars
// rising from it (the party). Plain SVG strings shared by the icon generator
// and the desktop splash (the web header uses public/icons/logo-mark.svg).

export const COLORS = { volt: "#d7ff3a", magenta: "#ff3dac", violet: "#8b5cff", ink: "#07070b" };

/** The mark on a transparent 100×100 canvas. `glow` adds a neon halo (large sizes only). */
export function markSvg({ glow = true } = {}) {
  return `
  <defs>
    <linearGradient id="moon" x1="18" y1="18" x2="70" y2="86" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f4ff9e"/>
      <stop offset="0.45" stop-color="${COLORS.volt}"/>
      <stop offset="1" stop-color="#7dff8a"/>
    </linearGradient>
    <linearGradient id="bars" x1="0" y1="86" x2="0" y2="30" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.violet}"/>
      <stop offset="0.55" stop-color="${COLORS.magenta}"/>
      <stop offset="1" stop-color="#ff9ad5"/>
    </linearGradient>
    <mask id="crescent">
      <rect width="100" height="100" fill="#fff"/>
      <circle cx="58" cy="40" r="25" fill="#000"/>
    </mask>
    ${glow ? `<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : ""}
  </defs>
  <g ${glow ? 'filter="url(#glow)"' : ""}>
    <circle cx="44" cy="54" r="32" fill="url(#moon)" mask="url(#crescent)"/>
    <g stroke="#120b2c" stroke-width="3" paint-order="stroke" fill="url(#bars)">
      <rect x="52" y="58" width="7" height="22" rx="3.5"/>
      <rect x="62.5" y="44" width="7" height="36" rx="3.5"/>
      <rect x="73" y="52" width="7" height="28" rx="3.5"/>
      <rect x="83.5" y="36" width="7" height="44" rx="3.5"/>
    </g>
  </g>
  <path d="M80 14 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6z" fill="#fff" opacity="0.95"/>`;
}

/** App icon: the mark on a night-sky squircle. */
export function iconSvg(size, { padding = 0.14, simple = false, square = false } = {}) {
  const inner = 100 * (1 - padding * 2);
  const offset = 100 * padding;
  const radius = square ? 0 : 23;
  const stars = simple
    ? ""
    : [
        [16, 18, 0.9], [30, 11, 0.6], [12, 40, 0.5], [88, 70, 0.55], [70, 88, 0.45], [92, 30, 0.4], [22, 84, 0.5],
      ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.7"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#23104f"/>
      <stop offset="0.55" stop-color="#0d0a24"/>
      <stop offset="1" stop-color="${COLORS.ink}"/>
    </linearGradient>
    <radialGradient id="haze1" cx="20" cy="90" r="55" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.magenta}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${COLORS.magenta}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haze2" cx="92" cy="8" r="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.violet}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${COLORS.violet}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="shape"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="100" height="100" fill="url(#sky)"/>
    <rect width="100" height="100" fill="url(#haze1)"/>
    <rect width="100" height="100" fill="url(#haze2)"/>
    ${stars}
    <rect x="0.5" y="0.5" width="99" height="99" rx="${radius}" fill="none" stroke="#fff" stroke-opacity="0.08"/>
  </g>
  <svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" viewBox="0 0 100 100">${markSvg({ glow: !simple })}</svg>
</svg>`;
}
