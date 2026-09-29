import { describe, expect, it } from "vitest";

import { syntheticAdventureJson } from "@/domain/adventure/adventure-fixtures";
import { parseAdventure, parseAdventureIndex } from "@/domain/adventure/parse";

function mutate(change: (value: Record<string, any>) => void) {
  const value = syntheticAdventureJson() as Record<string, any>;
  change(value);
  return value;
}

describe("parseAdventure", () => {
  it("accepts a complete document", () => {
    const adventure = parseAdventure(syntheticAdventureJson());
    expect(adventure.id).toBe("ridge-day");
    expect(adventure.legs.map((leg) => leg.slug)).toEqual(["leg-one", "leg-two"]);
    expect(adventure.film?.beats).toHaveLength(3);
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseAdventure(mutate((value) => { value.schemaVersion = 2; }))).toThrow(/schemaVersion/);
  });

  it("rejects unknown top-level fields rather than silently dropping them", () => {
    expect(() => parseAdventure(mutate((value) => { value.track = []; }))).toThrow(/track/);
  });

  it("rejects an anchor on a recording that is not one of the legs", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.chapters[0].anchor.slug = "elsewhere"; })),
    ).toThrow(/chapters\[0\]\.anchor\.slug/);
  });

  it("rejects a chapter that names footage the adventure does not have", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.chapters[0].footageId = "missing"; })),
    ).toThrow(/chapters\[0\]\.footageId/);
  });

  it("rejects media paths that escape the adventure directory", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.footage[0].src = "../secret.mp4"; })),
    ).toThrow(/footage\[0\]\.src/);
    expect(() =>
      parseAdventure(mutate((value) => { value.footage[0].src = "https://example.com/a.mp4"; })),
    ).toThrow(/footage\[0\]\.src/);
  });

  it("rejects a clip whose out point is not after its in point", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.film.beats[0].outS = 0; })),
    ).toThrow(/film\.beats\[0\]/);
  });

  it("rejects a scene beat without a footage fallback", () => {
    expect(() =>
      parseAdventure(mutate((value) => { delete value.film.beats[2].fallback; })),
    ).toThrow(/film\.beats\[2\]\.fallback/);
  });

  it("rejects a film longer than three minutes", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.film.beats[1].durationS = 200; })),
    ).toThrow(/film.*three minutes/);
  });

  it("rejects a scene passage beyond the end of its tour", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.film.beats[2].outS = 9; })),
    ).toThrow(/film\.beats\[2\].*tour/);
  });

  it("rejects a fallback clip shorter than the scene shot it replaces", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.film.beats[2].fallback.outS = 2; })),
    ).toThrow(/film\.beats\[2\]\.fallback/);
  });

  it("requires scene attribution on the author's own site", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.scenes[0].attribution.url = "https://example.com"; })),
    ).toThrow(/scenes\[0\]\.attribution\.url/);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseAdventure(mutate((value) => { value.chapters[1].id = "top"; })),
    ).toThrow(/duplicate/);
  });
});

describe("footage origin", () => {
  it("treats footage without an origin as the owner's recording", () => {
    expect(parseAdventure(syntheticAdventureJson()).footage[0].origin).toBe("recorded");
  });

  it("accepts a rendered flyover only with a credit", () => {
    const rendered = parseAdventure(mutate((value) => { value.footage[1].origin = "rendered"; value.footage[1].credit = "Google Earth Studio"; }));
    expect(rendered.footage[1]).toMatchObject({ origin: "rendered", credit: "Google Earth Studio" });
    expect(() => parseAdventure(mutate((value) => { value.footage[1].origin = "rendered"; }))).toThrow(/footage\[1\]\.credit/);
    expect(() => parseAdventure(mutate((value) => { value.footage[1].origin = "generated"; }))).toThrow(/footage\[1\]\.origin/);
  });
});

describe("parseAdventureIndex", () => {
  it("lists adventures by the recordings they cover", () => {
    const index = parseAdventureIndex({
      schemaVersion: 1,
      adventures: [{ id: "ridge-day", title: "Ridge day.", legs: ["leg-one", "leg-two"] }],
    });
    expect(index.adventures[0].legs).toEqual(["leg-one", "leg-two"]);
  });

  it("rejects an index entry without legs", () => {
    expect(() =>
      parseAdventureIndex({ schemaVersion: 1, adventures: [{ id: "x", title: "X", legs: [] }] }),
    ).toThrow(/legs/);
  });
});
