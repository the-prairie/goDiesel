import { describe, expect, it } from "vitest";

import {
  coordinateAt,
  syntheticAdventureJson,
  syntheticRoute,
  syntheticTrace,
} from "@/domain/adventure/adventure-fixtures";
import { parseAdventure } from "@/domain/adventure/parse";
import { chapterAt, placeAdventureOnRoute } from "@/domain/adventure/placement";
import { placeOnLegs, projectOntoRecording } from "@/domain/adventure/projection";

const adventure = parseAdventure(syntheticAdventureJson());

describe("projectOntoRecording", () => {
  it("finds the recorded distance of a nearby coordinate", () => {
    const hit = projectOntoRecording(syntheticTrace(5000), [], { lat: coordinateAt(2450).lat, lng: 0.0001 });
    expect(hit?.atDistanceM).toBeCloseTo(2450, 0);
    expect(hit?.offsetM).toBeGreaterThan(10);
    expect(hit?.offsetM).toBeLessThan(12);
  });

  it("never lands inside a discontinuity", () => {
    const gap = { kind: "missing_position_records" as const, source: "recorded_position_absence" as const, startD: 2000, endD: 3000 };
    const hit = projectOntoRecording(syntheticTrace(5000), [gap], coordinateAt(2500));
    expect(hit).toBeDefined();
    expect(hit!.atDistanceM <= 2000 || hit!.atDistanceM >= 3000).toBe(true);
  });

  it("prefers the pass nearest the hint when a recording crosses itself", () => {
    // Out and back: 0..2000 north, then 2000..4000 south over the same line.
    const out = syntheticTrace(2000);
    const back = out.slice(0, -1).reverse().map((point, index) => ({ ...point, d: 2100 + index * 100 }));
    const trace = [...out, ...back];
    expect(projectOntoRecording(trace, [], coordinateAt(500), 3500)?.atDistanceM).toBeCloseTo(3500, 0);
    expect(projectOntoRecording(trace, [], coordinateAt(500), 400)?.atDistanceM).toBeCloseTo(500, 0);
  });
});

describe("placeAdventureOnRoute", () => {
  it("returns undefined for a route the adventure does not cover", () => {
    expect(placeAdventureOnRoute(adventure, syntheticRoute("unrelated", 4000))).toBeUndefined();
  });

  it("places this leg's chapters in recorded order with their footage", () => {
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000))!;
    expect(placed.chapters.map((chapter) => chapter.id)).toEqual(["saddle", "top"]);
    expect(placed.chapters[1].footage?.id).toBe("clip-a");
    expect(placed.chapters[1].atDistanceM).toBe(3000);
  });

  it("numbers chapters across the whole adventure, legs first", () => {
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000))!;
    expect(placed.chapters.map((chapter) => chapter.ordinal)).toEqual([2, 3]);
    expect(placed.chapterCount).toBe(3);
  });

  it("links neighbouring legs without joining their geometry", () => {
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000))!;
    expect(placed.legIndex).toBe(1);
    expect(placed.previousLeg?.slug).toBe("leg-one");
    expect(placed.nextLeg).toBeUndefined();
  });

  it("withholds an anchor whose coordinate no longer matches the recording", () => {
    // The recording moved 1 km north since the adventure was prepared.
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000, [], 0.009))!;
    expect(placed.chapters).toEqual([]);
    expect(placed.withheld.map((item) => item.id).sort()).toEqual(["cirque", "saddle", "top"]);
    expect(placed.withheld[0].reason).toMatch(/does not match/);
  });

  it("withholds an anchor beyond the end of the recording", () => {
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 2500))!;
    expect(placed.chapters.map((chapter) => chapter.id)).toEqual(["saddle"]);
    expect(placed.withheld.find((item) => item.id === "top")?.reason).toMatch(/beyond/);
  });

  it("withholds an anchor inside a recording gap", () => {
    const gap = { kind: "missing_position_records" as const, source: "recorded_position_absence" as const, startD: 2900, endD: 3100 };
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000, [gap]))!;
    expect(placed.withheld.find((item) => item.id === "top")?.reason).toMatch(/gap/);
  });

  it("places scenes and keeps the film only while all its footage resolves", () => {
    const placed = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000))!;
    expect(placed.scenes.map((scene) => [scene.id, scene.atDistanceM])).toEqual([["cirque", 2000]]);
    expect(placed.film?.beats).toHaveLength(3);
  });
});

describe("chapterAt", () => {
  const chapters = placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4000))!.chapters;

  it("is empty before the first chapter on this recording", () => {
    expect(chapterAt(chapters, 400)).toBeUndefined();
  });

  it("holds the last chapter reached", () => {
    expect(chapterAt(chapters, 1000)?.id).toBe("saddle");
    expect(chapterAt(chapters, 2999)?.id).toBe("saddle");
    expect(chapterAt(chapters, 3600)?.id).toBe("top");
  });
});

describe("placeOnLegs", () => {
  // Out and back as two recordings over the same line: leg 0 north, leg 1 south.
  const out = syntheticTrace(3000);
  const back = [...out].reverse().map((point, index) => ({ ...point, d: index * 100 }));
  const legs = [{ trace: out, gaps: [] }, { trace: back, gaps: [] }];
  const coordinate = coordinateAt(1000);

  it("keeps an anchor on the leg its pack distance names, even where the legs overlap", () => {
    const placed = placeOnLegs(legs, coordinate, 2000, 1)!;
    expect(placed.legIndex).toBe(1);
    expect(placed.hit.atDistanceM).toBeCloseTo(2000, 0);
  });

  it("without a pack distance, takes the nearest leg, and the first on an exact tie", () => {
    const placed = placeOnLegs(legs, coordinate)!;
    expect(placed.legIndex).toBe(0);
    expect(placed.hit.atDistanceM).toBeCloseTo(1000, 0);
  });
});
