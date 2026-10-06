import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseIcs } from "@/server/discovery/parsers/ics";
import { extractJsonLdBlocks, flattenNodes, jsonLdToEvents, jsonLdToVenues } from "@/server/discovery/parsers/jsonld";
import { detectCategory, detectGenres, fixEndAfterStart, normalizeEvent, parseTitle } from "@/server/discovery/normalize";
import { DUPLICATE_THRESHOLD, POSSIBLE_DUPLICATE_THRESHOLD, scoreMatch, titleSimilarity, venueSimilarity } from "@/server/discovery/dedupe";
import { isExpired, qualityIssues } from "@/server/discovery/validate";
import { parseDurationMinutes } from "@/lib/duration";

const TZ = "Europe/Madrid";
const fixture = (f: string) => readFileSync(path.join(__dirname, "../fixtures", f), "utf8");

describe("title parsing", () => {
  it("splits title, venue and time", () => {
    expect(parseTitle("SATURDAY NIGHT @ CLUB XYZ - 23:30")).toEqual({ title: "Saturday Night", venueHint: "Club XYZ", timeHint: "23:30" });
  });
  it("keeps acronyms and accents", () => {
    expect(parseTitle("FM GRÀCIA").title).toBe("FM Gràcia");
    expect(parseTitle("NOCHE DE LA SALSA").title).toBe("Noche de la Salsa");
    expect(parseTitle("Warehouse: Dark Edition").title).toBe("Warehouse: Dark Edition");
  });
  it("reads 23.30h style times", () => expect(parseTitle("Closing party 23.30h").timeHint).toBe("23:30"));
});

describe("taxonomy", () => {
  it("detects genres only from explicit fields and title", () => {
    expect(detectGenres(["Techno", "Tech House"], "Warehouse")).toEqual(["techno", "house"]);
    expect(detectGenres([], "Perreo Nights")).toEqual(["reggaeton"]);
    expect(detectGenres([], "Saturday Night")).toEqual([]);
  });
  it("detects categories", () => {
    expect(detectCategory("Festa Major de Gràcia", null, false)).toBe("fm");
    expect(detectCategory("Primavera Festival", null, false)).toBe("festival");
    expect(detectCategory("Saturday Night", null, true)).toBe("discoteca");
  });
});

describe("night times", () => {
  it("Friday 23:30 → Saturday 06:00 (not Sunday)", () => {
    const r = normalizeEvent({ externalId: "x", title: "Friday Session", start: { kind: "local", date: "2026-10-02", time: "23:30", tz: TZ }, end: { kind: "local", date: "2026-10-02", time: "06:00", tz: TZ }, place: { name: "Club", lat: 41.4, lng: 2.19 } }, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.startsAt).toBe("2026-10-02T21:30:00.000Z"); // Fri 23:30 CEST
    expect(r.event.endsAt).toBe("2026-10-03T04:00:00.000Z"); // Sat 06:00 CEST
  });
  it("keeps a correct next-day end untouched", () => {
    const start = new Date("2026-10-02T21:59:00Z");
    expect(fixEndAfterStart(start, new Date("2026-10-03T04:00:00Z"))?.toISOString()).toBe("2026-10-03T04:00:00.000Z");
  });
  it("uses the title time only when the source has no time", () => {
    const r = normalizeEvent({ externalId: "y", title: "Closing party - 23:59", start: { kind: "local", date: "2026-10-10", time: null, tz: TZ } }, TZ);
    expect(r.ok && r.event.startsAt).toBe("2026-10-10T21:59:00.000Z");
    expect(r.ok && r.event.timeUnknown).toBe(false);
  });
  it("marks unknown times instead of inventing them", () => {
    const r = normalizeEvent({ externalId: "z", title: "Open Air", start: { kind: "local", date: "2026-10-10", time: null, tz: TZ } }, TZ);
    expect(r.ok && r.event.timeUnknown).toBe(true);
  });
});

describe("iCalendar", () => {
  const events = parseIcs(fixture("club.ics"));
  it("parses events with TZID, escaping, GEO and categories", () => {
    expect(events).toHaveLength(4);
    const e = events[0]!;
    expect(e.externalId).toBe("evt-001@democlub.example");
    expect(e.start).toEqual({ kind: "local", date: "2026-10-02", time: "23:30", tz: "Europe/Madrid" });
    expect(e.description).toContain("Entrada libre hasta la 1, luego 15 €");
    expect(e.place).toMatchObject({ name: "Club XYZ", lat: 41.3987, lng: 2.1962 });
    expect(e.genres).toEqual(["Techno", "House"]);
  });
  it("handles UTC, cancelled, recurring and all-day events (ignoring VALARM)", () => {
    expect(events[1]!.start).toEqual({ kind: "instant", iso: "2026-10-03T21:30:00Z" });
    expect(events[1]!.cancelled).toBe(true);
    expect(events[2]!.unsupported).toMatch(/RRULE/);
    expect(events[3]!.start).toMatchObject({ kind: "local", time: null });
    expect(events[3]!.description).toBeNull();
  });
  it("normalizes to ORIVEXY NIGHTS format without inventing a price", () => {
    const r = normalizeEvent(events[0]!, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({ title: "Saturday Night", venueName: "Club XYZ", genres: ["techno", "house"], priceMin: null, category: "discoteca" });
  });
});

describe("schema.org JSON-LD", () => {
  const nodes = flattenNodes(extractJsonLdBlocks(fixture("club-page.html")));
  it("extracts events with offers, place and organizer", () => {
    const [e] = jsonLdToEvents(nodes, "https://democlub.example/agenda", TZ);
    expect(e).toMatchObject({ title: "Saturday Night", priceMin: 1500, priceMax: 2000, currency: "EUR", ticketUrl: "https://tickets.example/saturday", organizerName: "XYZ Crew" });
    expect(e!.start).toEqual({ kind: "instant", iso: "2026-10-02T21:30:00.000Z" });
  });
  it("extracts venues", () => {
    const [v] = jsonLdToVenues(nodes, "https://democlub.example/");
    expect(v).toMatchObject({ name: "Club XYZ", phone: "+34 930 000 000", lat: 41.3987, instagram: "https://www.instagram.com/democlub" });
  });
});

describe("deduplication", () => {
  const base = { startsAt: new Date("2026-10-02T21:30:00Z"), venueId: "v1", locationName: "Club XYZ", lat: 41.3987, lng: 2.1962, organizerName: null, urls: [] };
  it("same party from two sources is a duplicate", () => {
    const s = scoreMatch({ ...base, title: "Saturday Night" }, { ...base, title: "SATURDAY NIGHT @ Club XYZ", startsAt: new Date("2026-10-02T22:00:00Z") });
    expect(s.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });
  it("same venue, different night is not", () => {
    expect(scoreMatch({ ...base, title: "Saturday Night" }, { ...base, title: "Saturday Night", startsAt: new Date("2026-10-09T21:30:00Z") }).score).toBe(0);
  });
  it("different party at the same venue and time is only a possible duplicate at most", () => {
    const s = scoreMatch({ ...base, title: "Perreo Nights" }, { ...base, title: "Techno Marathon" });
    expect(s.score).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(s.score).toBeGreaterThanOrEqual(POSSIBLE_DUPLICATE_THRESHOLD - 0.1);
  });
  it("a shared URL is conclusive", () => {
    expect(scoreMatch({ ...base, title: "A", urls: ["https://www.democlub.example/e/1?utm_source=x"] }, { ...base, venueId: null, title: "B", urls: ["https://democlub.example/e/1"] }).score).toBe(1);
  });
  it("ignores venue words when comparing titles", () => {
    expect(titleSimilarity("Sala X presents NIGHT SESSION", "Night Session", "Sala X")).toBeGreaterThan(0.8);
  });
  it("matches venues by name + coordinates", () => {
    expect(venueSimilarity({ name: "Sala Nébula", lat: 41.4031, lng: 2.2004 }, { name: "SALA NEBULA", lat: 41.4032, lng: 2.2005 })).toBeGreaterThan(0.9);
    expect(venueSimilarity({ name: "Sala Nébula", lat: 41.4031, lng: 2.2004 }, { name: "Club Vértice", lat: 41.3934, lng: 2.1541 })).toBeLessThan(0.3);
  });
});

describe("quality gate", () => {
  const city = { name: "Barcelona", lat: 41.3874, lng: 2.1686, searchRadiusKm: 25 };
  const now = new Date("2026-09-30T10:00:00Z");
  const ok = normalizeEvent({ externalId: "q", title: "Saturday Night", start: { kind: "instant", iso: "2026-10-02T21:30:00Z" }, place: { name: "Club XYZ", lat: 41.3987, lng: 2.1962 } }, TZ);
  it("passes complete events", () => expect(ok.ok && qualityIssues(ok.event, { now, city })).toEqual([]));
  it("flags missing location and far away events", () => {
    if (!ok.ok) throw new Error();
    expect(qualityIssues({ ...ok.event, lat: null, lng: null }, { now, city })).toContain("Ubicación desconocida");
    expect(qualityIssues({ ...ok.event, lat: 40.4168, lng: -3.7038 }, { now, city })).toContain("Fuera del área de Barcelona");
  });
  it("drops expired events", () => {
    if (!ok.ok) throw new Error();
    expect(isExpired(ok.event, new Date("2026-10-05T00:00:00Z"))).toBe(true);
  });
});

describe("durations", () => {
  it("parses intervals", () => {
    expect(parseDurationMinutes("30m", 5)).toBe(30);
    expect(parseDurationMinutes("2h", 5)).toBe(120);
    expect(parseDurationMinutes("1d", 5)).toBe(1440);
    expect(parseDurationMinutes("nope", 5)).toBe(5);
  });
});

import { parseRobots, robotsPathAllowed } from "@/server/discovery/parsers/robots";

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/agenda\n\nUser-agent: examplebot\nDisallow: /events/*.json$\n";
  it("uses the most specific group for our bot", () => {
    const rules = parseRobots(txt, "examplebot");
    expect(robotsPathAllowed(rules, "/private")).toBe(true);
    expect(robotsPathAllowed(rules, "/events/list.json")).toBe(false);
  });
  it("falls back to * and longest match wins", () => {
    const rules = parseRobots(txt, "otherbot");
    expect(robotsPathAllowed(rules, "/private/x")).toBe(false);
    expect(robotsPathAllowed(rules, "/private/agenda/1")).toBe(true);
    expect(robotsPathAllowed(rules, "/")).toBe(true);
  });
});
