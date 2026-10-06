/**
 * Input schemas shared by API routes and forms. Every mutation goes through
 * one of these before touching the database.
 */
import { z } from "zod";
import { CATEGORIES, GENRES } from "@/config/taxonomy";
import { cleanText } from "./text";

const text = (max: number) => z.string().max(max * 2).transform(cleanText).pipe(z.string().max(max));
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().max(max))
    .optional()
    .transform((v) => (v ? v : undefined));

export const cuid = z.string().min(10).max(40).regex(/^[a-z0-9]+$/i);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Mínimo 3 caracteres")
  .max(24, "Máximo 24 caracteres")
  .regex(/^[a-z0-9_.]+$/, "Solo letras, números, punto y guion bajo")
  .refine((v) => !/^[._]|[._]$|\.\./.test(v), "Formato de usuario no válido");

export const passwordSchema = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .max(128, "Máximo 128 caracteres")
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Incluye al menos una letra y un número");

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Email no válido"));

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: text(50).pipe(z.string().min(1, "Escribe tu nombre")),
  /** Honeypot: must stay empty. Bots fill every field. */
  website: z.string().max(0).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(100),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  /** Required when the account already has a password (OAuth-only accounts set one). */
  currentPassword: z.string().max(128).optional(),
  password: passwordSchema,
});

export const deleteAccountSchema = z.object({
  /** Typed username, to avoid accidental deletions. */
  confirm: z.string().max(40),
  password: z.string().max(128).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const profileUpdateSchema = z.object({
  username: usernameSchema.optional(),
  displayName: text(50).pipe(z.string().min(1)).optional(),
  bio: optionalText(200).nullable(),
  citySlug: z.string().max(40).optional(),
  avatarPhotoId: cuid.nullable().optional(),
  favoriteGenres: z.array(z.enum(GENRES.map((g) => g.slug) as [string, ...string[]])).max(8).optional(),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida");

export const eventInputSchema = z
  .object({
    title: text(80).pipe(z.string().min(3, "Mínimo 3 caracteres")),
    description: optionalText(2000),
    category: z.enum(CATEGORIES.map((c) => c.slug) as [string, ...string[]]),
    genres: z.array(z.enum(GENRES.map((g) => g.slug) as [string, ...string[]])).max(4).default([]),
    citySlug: z.string().max(40),
    venueId: cuid.optional().nullable(),
    locationName: text(80).pipe(z.string().min(2, "Indica el lugar")),
    address: optionalText(160),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    date: dateString,
    startTime: timeString,
    endTime: timeString.optional().nullable(),
    isFree: z.boolean(),
    price: z.number().min(0).max(1000).optional().nullable(),
    minAge: z.number().int().min(0).max(25).optional().nullable(),
    ticketUrl: z.url({ protocol: /^https$/ }).max(300).optional().nullable().or(z.literal("")),
    /**
     * NONE / EXTERNAL: informative price + optional external ticket link.
     * PLATFORM: native ticket sales — rejected while TICKETS_ENABLED is off.
     * Prices of ORIVEXY NIGHTS tickets always come from TicketType rows, never from here.
     */
    ticketing: z.enum(["NONE", "EXTERNAL", "PLATFORM"]).optional(),
    capacity: z.number().int().min(1).max(100_000).optional().nullable(),
    refundPolicy: optionalText(1000).nullable(),
    coverPhotoId: cuid.optional().nullable(),
    photoIds: z.array(cuid).max(8).default([]),
    /** Line-up: DJs, bands, performers (names only). */
    artists: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    /** Save without publishing: only the organizer sees it (preview). */
    draft: z.boolean().optional(),
  })
  .refine((v) => v.isFree || (v.price != null && v.price > 0), {
    message: "Indica el precio o marca el evento como gratis",
    path: ["price"],
  });

export type EventInput = z.infer<typeof eventInputSchema>;

export const attendanceSchema = z.object({
  status: z.enum(["INTERESTED", "GOING"]).nullable(),
});

const score = z.number().int().min(1).max(5);

export const reviewSchema = z.object({
  rating: score,
  ambience: score.optional().nullable(),
  music: score.optional().nullable(),
  staff: score.optional().nullable(),
  price: score.optional().nullable(),
  space: score.optional().nullable(),
  comment: optionalText(1000),
});

export const postInputSchema = z
  .object({
    caption: optionalText(500),
    photoIds: z.array(cuid).max(10).default([]),
    videoId: cuid.optional().nullable(),
    eventId: cuid.optional().nullable(),
    venueId: cuid.optional().nullable(),
    taggedUsernames: z.array(usernameSchema).max(10).default([]),
    locationName: optionalText(80),
  })
  .refine((v) => (v.videoId ? v.photoIds.length === 0 : v.photoIds.length > 0), {
    message: "Añade fotos o un vídeo",
    path: ["photoIds"],
  });

export const commentSchema = z.object({
  body: text(500).pipe(z.string().min(1, "Escribe un comentario")),
});

export const reportSchema = z.object({
  targetType: z.enum(["USER", "EVENT", "VENUE", "POST", "PHOTO", "VIDEO", "COMMENT"]),
  targetId: cuid,
  reason: z.enum(["SPAM", "INAPPROPRIATE", "HARASSMENT", "FAKE_EVENT", "WRONG_INFO", "OTHER"]),
  details: optionalText(500),
});

export const venuePhotoSchema = z.object({ photoIds: z.array(cuid).min(1).max(10) });

export const paginationSchema = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const venueAdminUpdateSchema = z.object({
  name: text(80).pipe(z.string().min(2)).optional(),
  description: optionalText(2000).nullable(),
  address: text(160).optional(),
  neighborhood: optionalText(60).nullable(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  priceMin: z.number().int().min(0).max(100000).nullable().optional(),
  priceMax: z.number().int().min(0).max(100000).nullable().optional(),
  minAge: z.number().int().min(0).max(25).nullable().optional(),
  website: z.url({ protocol: /^https?$/ }).max(300).nullable().optional().or(z.literal("")),
  instagram: optionalText(60).nullable(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida");
/** Weekly hours: { mon: [{ open: "23:00", close: "06:00" }], … }; close ≤ open = next day. */
export const openingHoursSchema = z
  .object(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, z.array(z.object({ open: hhmm, close: hhmm })).max(3).optional()])))
  .strict();

/** Venue profile edited by its managers (or staff) — never trust/featured/active. */
export const venueManageSchema = z.object({
  name: text(80).pipe(z.string().min(2)).optional(),
  description: optionalText(2000).nullable(),
  address: text(160).optional(),
  neighborhood: optionalText(60).nullable(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: optionalText(40).nullable(),
  website: z.url({ protocol: /^https?$/ }).max(300).nullable().optional().or(z.literal("").transform(() => null)),
  instagram: optionalText(60).nullable(),
  priceMin: z.number().int().min(0).max(100000).nullable().optional(),
  priceMax: z.number().int().min(0).max(100000).nullable().optional(),
  minAge: z.number().int().min(0).max(25).nullable().optional(),
  genres: z.array(z.string().max(20)).max(5).optional(),
  openingHours: openingHoursSchema.nullable().optional(),
  coverPhotoId: z.string().max(40).nullable().optional(),
});

export const venueCreateSchema = z.object({
  name: text(80).pipe(z.string().min(2, "Escribe el nombre")),
  citySlug: z.string().max(40),
  type: z.enum(["CLUB", "BAR", "CONCERT_HALL", "OPEN_AIR", "OTHER"]),
  address: text(160).pipe(z.string().min(3, "Escribe la dirección")),
  neighborhood: optionalText(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  website: z.url({ protocol: /^https?$/ }).max(300).optional().or(z.literal("").transform(() => undefined)),
});

// ─── Commerce (admin + owners) ────────────────────────────────────────────────

const bpsRate = z.number().int().min(0).max(10_000);
const cents = z.number().int().min(0).max(10_000_000);

export const commissionRuleSchema = z.object({
  name: text(80).pipe(z.string().min(2)),
  businessId: cuid.nullable().optional(),
  platformFeeBps: bpsRate,
  platformFeeFixed: cents,
  providerFeeBps: bpsRate,
  providerFeeFixed: cents,
  taxRateBps: bpsRate,
  taxIncluded: z.boolean(),
  feesPaidByBuyer: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  isActive: z.boolean(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
});

export const planUpdateSchema = z.object({
  name: text(60).pipe(z.string().min(2)).optional(),
  description: optionalText(300).nullable(),
  priceCents: cents.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  interval: z.enum(["month", "year"]).optional(),
});

export const businessCreateSchema = z.object({
  username: usernameSchema,
  type: z.enum(["ORGANIZER", "VENUE"]),
  tradeName: text(80).pipe(z.string().min(2)),
  contactEmail: emailSchema.optional(),
  contactPhone: optionalText(30),
  website: z.url({ protocol: /^https?$/ }).max(300).optional(),
  venueSlug: z.string().max(80).optional(),
});

export const businessAdminUpdateSchema = z.object({
  verification: z.enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"]).optional(),
  commercialStatus: z.enum(["INACTIVE", "ACTIVE", "SUSPENDED"]).optional(),
  plan: z.enum(["PLAN_FREE", "PLAN_PREMIUM", "PLAN_BUSINESS"]).optional(),
  reviewNote: optionalText(300),
});

export const businessRequestSchema = z.object({
  type: z.enum(["ORGANIZER", "VENUE"]),
  tradeName: text(80).pipe(z.string().min(2, "Escribe el nombre")),
  contactEmail: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  contactPhone: optionalText(30),
  website: z.url({ protocol: /^https?$/ }).max(300).optional().or(z.literal("").transform(() => undefined)),
  venueId: z.string().max(40).optional().or(z.literal("").transform(() => undefined)),
  message: optionalText(500),
});

/** Owners may only edit contact data — never verification, status or plan. */
export const businessOwnerUpdateSchema = z
  .object({
    contactEmail: emailSchema.nullable().optional(),
    contactPhone: optionalText(30).nullable(),
    website: z.url({ protocol: /^https?$/ }).max(300).nullable().optional(),
  })
  .strict();

export const orderCreateSchema = z.object({
  eventId: cuid,
  items: z.array(z.object({ ticketTypeId: cuid, quantity: z.number().int().min(1).max(20) })).min(1).max(10),
  idempotencyKey: z.string().min(16).max(64).optional(),
});

export const promotionCreateSchema = z.object({
  type: z.enum(["FEATURED_EVENT", "FEATURED_VENUE", "SPONSORED_POST", "AD"]),
  /** Event slug, venue slug or post id depending on the type. */
  target: z.string().trim().min(3).max(120),
  businessId: cuid.optional(),
  placement: z.enum(["HOME", "DISCOVER", "FEED", "SEARCH", "MAP"]).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  budgetCents: cents.optional(),
  notes: optionalText(500),
});

export const refundRequestSchema = z.object({
  orderId: cuid,
  amount: cents.min(1).nullable(),
  reason: optionalText(300),
});

// ─── Event discovery (admin) ─────────────────────────────────────────────────

export const discoverySourceSchema = z.object({
  name: text(80).pipe(z.string().min(2)),
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, "Solo minúsculas, números y guiones"),
  type: z.enum(["ICS_FEED", "JSON_LD_PAGE", "PARTNER_FEED", "TICKETMASTER", "GOOGLE_PLACES", "OSM_OVERPASS", "MADRID_AGENDA", "CATALONIA_AGENDA", "BCN_MUSIC_VENUES"]),
  url: z.url({ protocol: /^https?$/ }).max(500).nullable().optional().or(z.literal("").transform(() => null)),
  citySlug: z.string().max(40),
  venueSlug: z.string().max(80).nullable().optional().or(z.literal("").transform(() => null)),
  trust: z.enum(["IMPORTED", "OFFICIAL"]).default("IMPORTED"),
  autoPublish: z.boolean().default(false),
  allowImages: z.boolean().default(false),
  deactivateMissing: z.boolean().default(true),
  enabled: z.boolean().default(false),
  syncIntervalMin: z.number().int().min(5).max(7 * 24 * 60).nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const discoverySourceUpdateSchema = discoverySourceSchema.omit({ key: true, type: true, citySlug: true }).partial();

export const discoveryRecordActionSchema = z.object({
  action: z.enum(["approve", "reject", "merge", "delete"]),
  /** Target event for "merge": id or slug. */
  eventId: z.string().trim().min(3).max(120).optional(),
  edits: z
    .object({
      title: text(120).pipe(z.string().min(3)).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      venueId: cuid.nullable().optional(),
      locationName: text(80).optional(),
      address: text(160).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      priceMin: z.number().int().min(0).max(1_000_000).nullable().optional(),
    })
    .optional(),
});

export const venueRecordActionSchema = z.object({
  action: z.enum(["approve", "reject", "merge", "delete"]),
  venueId: cuid.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  address: text(160).optional(),
});
