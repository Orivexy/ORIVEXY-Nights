import { describe, expect, it } from "vitest";
import { hasTaste, rankEvents, scoreEvent, type Candidate, type TasteSignals } from "@/lib/recommend";

const now = new Date("2026-11-01T18:00:00Z");
const ev = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  startsAt: new Date("2026-11-03T22:00:00Z"),
  lat: 41.39,
  lng: 2.17,
  venueId: null,
  genres: [],
  artistIds: [],
  interestedCount: 0,
  goingCount: 0,
  isFeatured: false,
  ...over,
});
const none: TasteSignals = { genres: new Set(), venueIds: new Set(), artistIds: new Set() };

describe("recommendations", () => {
  it("knows when there is no taste to rank by", () => {
    expect(hasTaste(none)).toBe(false);
    expect(hasTaste({ ...none, genres: new Set(["techno"]) })).toBe(true);
  });

  it("puts followed artists and venues above a merely popular event", () => {
    const taste: TasteSignals = { genres: new Set(), venueIds: new Set(["v1"]), artistIds: new Set(["a1"]) };
    const popular = ev("popular", { interestedCount: 150, goingCount: 50 });
    const artist = ev("artist", { artistIds: ["a1"] });
    const venue = ev("venue", { venueId: "v1" });
    expect(rankEvents([popular, venue, artist], taste, now, 3).map((e) => e.id)).toEqual(["artist", "venue", "popular"]);
  });

  it("rewards favourite genres, closeness and sooner dates, all bounded", () => {
    const taste: TasteSignals = { genres: new Set(["techno", "house"]), venueIds: new Set(), artistIds: new Set(), coords: { lat: 41.39, lng: 2.17 } };
    const match = scoreEvent(ev("m", { genres: ["techno", "house", "minimal"] }), taste, now);
    const plain = scoreEvent(ev("p"), taste, now);
    expect(match).toBeGreaterThan(plain);
    const far = scoreEvent(ev("f", { lat: 41.6, lng: 2.4 }), taste, now);
    expect(plain).toBeGreaterThan(far);
    const later = scoreEvent(ev("l", { startsAt: new Date("2026-11-30T22:00:00Z") }), taste, now);
    expect(plain).toBeGreaterThan(later);
    expect(scoreEvent(ev("x", { interestedCount: 1e6 }), none, now)).toBeLessThanOrEqual(1 + 1 + 0.5 + 0.01);
  });
});
