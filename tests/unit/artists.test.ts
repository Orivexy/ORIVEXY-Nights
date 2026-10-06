import { describe, expect, it } from "vitest";
import { artistKey, cleanLineup } from "@/lib/artists";
import { jsonLdToEvents } from "@/server/discovery/parsers/jsonld";

describe("artists", () => {
  it("matches the same artist whatever the case, accents or spacing", () => {
    expect(artistKey("  Ríchie  HAWTIN ")).toBe(artistKey("richie hawtin"));
    expect(artistKey("DJ Tennis")).not.toBe(artistKey("DJ Tenis"));
  });

  it("cleans a line-up without inventing names", () => {
    expect(cleanLineup(["Amelie Lens", " amelie  lens", "", null, "x".repeat(61), "Charlotte de Witte"])).toEqual(["Amelie Lens", "Charlotte de Witte"]);
    expect(cleanLineup(Array.from({ length: 20 }, (_, i) => `DJ ${i}`), 12)).toHaveLength(12);
  });

  it("reads the line-up a source publishes as schema.org performer", async () => {
    const [e] = jsonLdToEvents(
      [{ "@type": "MusicEvent", name: "Noche", startDate: "2026-11-20T23:00:00+01:00", performer: [{ "@type": "Person", name: "Amelie Lens" }, "Charlotte de Witte"], location: { "@type": "Place", name: "Sala" } }],
      "https://example.com/agenda",
      "Europe/Madrid",
    );
    expect(e!.performers).toEqual(["Amelie Lens", "Charlotte de Witte"]);
  });
});
