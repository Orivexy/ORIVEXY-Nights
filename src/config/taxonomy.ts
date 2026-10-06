/**
 * Canonical categories and music genres. The database is seeded from these
 * lists; the UI reads them from the database so new ones can be added later.
 */
export const CATEGORIES = [
  { slug: "fm", name: "FM", emoji: "🎪" },
  { slug: "fiesta", name: "Fiesta", emoji: "🎉" },
  { slug: "discoteca", name: "Fiesta de club", emoji: "🪩" },
  { slug: "concierto", name: "Concierto", emoji: "🎤" },
  { slug: "dj", name: "Sesión DJ", emoji: "🎧" },
  { slug: "festival", name: "Festival", emoji: "🎡" },
  { slug: "especial", name: "Evento especial", emoji: "⭐" },
  { slug: "tematica", name: "Noche temática", emoji: "🎭" },
  { slug: "otro", name: "Otro", emoji: "✨" },
] as const;

export const GENRES = [
  { slug: "reggaeton", name: "Reggaeton" },
  { slug: "techno", name: "Techno" },
  { slug: "house", name: "House" },
  { slug: "hip-hop", name: "Hip Hop" },
  { slug: "comercial", name: "Comercial" },
  { slug: "electronica", name: "Electrónica" },
  { slug: "edm", name: "EDM" },
  { slug: "latin", name: "Latin" },
  { slug: "indie", name: "Indie" },
  { slug: "otro", name: "Otro" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
export type GenreSlug = (typeof GENRES)[number]["slug"];

export const REPORT_REASONS = [
  { value: "SPAM", label: "Spam" },
  { value: "INAPPROPRIATE", label: "Contenido inapropiado" },
  { value: "HARASSMENT", label: "Acoso" },
  { value: "FAKE_EVENT", label: "Evento falso" },
  { value: "WRONG_INFO", label: "Información incorrecta" },
  { value: "OTHER", label: "Otro" },
] as const;

/** Notifications a user can turn off (account and moderation notices always arrive). */
export const MUTABLE_NOTIFICATIONS = [
  { value: "VENUE_NEW_EVENT", label: "Nuevos eventos en locales que sigo" },
  { value: "ARTIST_NEW_EVENT", label: "Nuevas fechas de artistas que sigo" },
  { value: "EVENT_REMINDER", label: "Recordatorios de mis eventos" },
  { value: "FOLLOW", label: "Nuevos seguidores" },
  { value: "POST_LIKE", label: "Me gustas en mis publicaciones" },
  { value: "POST_COMMENT", label: "Comentarios en mis publicaciones" },
  { value: "POST_TAG", label: "Etiquetas en publicaciones" },
] as const;
