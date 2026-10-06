/**
 * Client-safe data shapes returned by the service layer and API. Keeping
 * them here (not in Prisma types) decouples UI from the database schema.
 */
export interface UserMini {
  id: string;
  username: string;
  displayName: string;
  avatarKey: string | null;
}

export interface CategoryMini {
  slug: string;
  name: string;
  emoji: string | null;
}

export interface GenreMini {
  slug: string;
  name: string;
}

export interface VenueMini {
  id: string;
  slug: string;
  name: string;
  ratingAvg: number;
  ratingCount: number;
}

/** Paid placement marker; anything but NONE must be labelled in the UI. */
export type SponsorType = "NONE" | "FEATURED" | "SPONSORED" | "AD";

export interface EventCardData {
  id: string;
  slug: string;
  title: string;
  coverKey: string | null;
  startsAt: Date;
  /** Date without published start time. */
  timeUnknown: boolean;
  endsAt: Date | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  timezone: string;
  locationName: string;
  address: string | null;
  lat: number;
  lng: number;
  category: CategoryMini;
  genres: GenreMini[];
  venue: VenueMini | null;
  /** Where to buy tickets, as published by the source. */
  ticketUrl: string | null;
  interestedCount: number;
  goingCount: number;
  isFeatured: boolean;
  promotionType: SponsorType;
  trust: "COMMUNITY" | "IMPORTED" | "OFFICIAL" | "VERIFIED";
  status: "DRAFT" | "PENDING" | "PUBLISHED" | "REJECTED" | "CANCELLED" | "INACTIVE";
}

export interface ViewerEventState {
  attendance: "INTERESTED" | "GOING" | null;
  saved: boolean;
}

export interface PhotoData {
  id: string;
  key: string;
  width: number;
  height: number;
  blurDataUrl: string | null;
}

export interface GalleryPhoto extends PhotoData {
  createdAt: Date;
  likeCount: number;
  uploader: UserMini;
  liked: boolean;
}

export interface EventDetail extends EventCardData {
  description: string | null;
  minAge: number | null;
  ticketUrl: string | null;
  /** null for imported events (organizer shown as `organizerName`). */
  organizer: UserMini | null;
  organizerName: string | null;
  isOfficial: boolean;
  officialUrl: string | null;
  doorsAt: Date | null;
  /** Discreet provenance for imported events. */
  attribution: { sources: Array<{ name: string; url: string | null }>; lastSyncedAt: Date | null } | null;
  city: { slug: string; name: string };
  photos: PhotoData[];
  attendeesPreview: UserMini[];
  viewer: ViewerEventState;
  canEdit: boolean;
  /** Line-up in billing order. */
  artists: Array<{ id: string; slug: string; name: string }>;
}

export interface VenueCardData {
  id: string;
  slug: string;
  name: string;
  type: string;
  coverKey: string | null;
  neighborhood: string | null;
  /** District (zone filter). */
  district: string | null;
  /** Verified state: OPEN, TEMPORARILY_CLOSED, PERMANENTLY_CLOSED. */
  status: string;
  /** Music and event styles. */
  musicTags: string[];
  address: string;
  lat: number;
  lng: number;
  ratingAvg: number;
  ratingCount: number;
  followerCount: number;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  genres: GenreMini[];
  promotionType: SponsorType;
}

export interface OpeningHours {
  [day: string]: Array<{ open: string; close: string }>;
}

export interface ReviewData {
  id: string;
  rating: number;
  ambience: number | null;
  music: number | null;
  staff: number | null;
  price: number | null;
  space: number | null;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: UserMini;
}

export interface VenueDetail extends VenueCardData {
  description: string | null;
  timezone: string;
  openingHours: OpeningHours | null;
  minAge: number | null;
  website: string | null;
  instagram: string | null;
  /** Official photos of the place (from its website), cover first. */
  officialPhotos: Array<{ id: string; key: string; width: number; height: number; blurDataUrl: string | null; zone: string | null }>;
  city: { slug: string; name: string };
  subScores: { ambience: number | null; music: number | null; staff: number | null; price: number | null; space: number | null };
  ratingDistribution: number[]; // index 0 → 1 star … index 4 → 5 stars
  viewer: { following: boolean; review: ReviewData | null; canManage: boolean };
  phone: string | null;
  /** Provenance (COMMUNITY / IMPORTED / OFFICIAL / VERIFIED) and freshness of the data. */
  provenance: {
    trust: string;
    sourceName: string | null;
    sourceUrl: string | null;
    attribution: string | null;
    lastVerifiedAt: Date | null;
    hoursUpdatedAt: Date | null;
  };
}

export interface FeedPost {
  id: string;
  type: "PHOTO" | "CAROUSEL" | "VIDEO";
  caption: string | null;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  locationName: string | null;
  promotionType: SponsorType;
  author: UserMini;
  photos: PhotoData[];
  video: { id: string; key: string; posterKey: string | null; width: number | null; height: number | null } | null;
  event: { id: string; slug: string; title: string; startsAt: Date } | null;
  venue: { id: string; slug: string; name: string } | null;
  tagged: UserMini[];
  viewer: { liked: boolean; saved: boolean; followsAuthor: boolean; isAuthor: boolean };
}

export interface CommentData {
  id: string;
  body: string;
  createdAt: Date;
  author: UserMini;
  canDelete: boolean;
}

export interface ProfileData extends UserMini {
  bio: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  eventCount: number;
  city: { slug: string; name: string } | null;
  joinedAt: Date;
  viewer: { isSelf: boolean; following: boolean; followsYou: boolean; blocked: boolean; blockedBy: boolean };
}

export interface NotificationData {
  id: string;
  type: string;
  createdAt: Date;
  read: boolean;
  actor: UserMini | null;
  post: { id: string; thumbKey: string | null } | null;
  event: { slug: string; title: string; startsAt: Date; coverKey: string | null } | null;
  comment: { body: string } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MapEvent {
  id: string;
  slug: string;
  title: string;
  startsAt: Date;
  /** Date without published start time. */
  timeUnknown?: boolean;
  endsAt: Date | null;
  priceMin: number | null; // cents; null = not available
  priceMax: number | null;
  category: string; // fm | fiesta | discoteca | concierto | dj | festival | otro
  genres: string[];
  coverKey: string | null;
  /** Where to buy tickets / official page, as published by the source (never guessed). */
  ticketUrl: string | null;
  officialUrl: string | null;
}

export interface MapPlace {
  kind: "venue" | "event";
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  coverKey: string | null;
  /** "" when the source gave no postal address. */
  address: string;
  neighborhood: string | null;
  /** Venue type (CLUB, BAR, CONCERT_HALL…) or null for standalone events. */
  venueType: string | null;
  /** Main place (always listed first). */
  featured?: boolean;
  genres: string[];
  /** ORIVEXY NIGHTS community rating (never a third-party rating we may not store). */
  ratingAvg: number | null;
  ratingCount: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  timezone: string;
  openingHours: OpeningHours | null;
  /** Upcoming events (for a standalone event: itself), soonest first. */
  events: MapEvent[];
  /** Data attribution required by the source licence (e.g. OpenStreetMap). */
  attribution: string | null;
}
