import { describe, expect, it } from "vitest";

import { syntheticAdventureJson, syntheticRoute } from "@/domain/adventure/adventure-fixtures";
import { checkAdventureEdit } from "@/domain/adventure/edit";
import { parseAdventure } from "@/domain/adventure/parse";
import { confirmAnchor, moveAnchor } from "@/domain/adventure/placement";

const saved = parseAdventure(syntheticAdventureJson());
const clone = () => structuredClone(saved);

describe("moveAnchor", () => {
  const route = syntheticRoute("leg-two", 4_000, [
    { kind: "missing_position_records", source: "recorded_position_absence", startD: 2_900, endD: 3_100 },
  ]);

  it("re-places the anchor at the recorded point for the new distance", () => {
    const moved = moveAnchor(route, saved.chapters[0].anchor, 1_550);
    expect(moved.atDistanceM).toBe(1_550);
    expect(confirmAnchor(route, moved)).toBeUndefined();
  });

  it("snaps out of a recording gap rather than into it", () => {
    const moved = moveAnchor(route, saved.chapters[0].anchor, 3_000);
    expect(moved.atDistanceM === 2_900 || moved.atDistanceM === 3_100).toBe(true);
    expect(confirmAnchor(route, moved)).toBeUndefined();
  });

  it("stays within the recording", () => {
    expect(moveAnchor(route, saved.chapters[0].anchor, 9_999).atDistanceM).toBe(4_000);
    expect(moveAnchor(route, saved.chapters[0].anchor, -5).atDistanceM).toBe(0);
  });
});

describe("checkAdventureEdit", () => {
  it("accepts owner edits to chapter wording, placement and footage association", () => {
    const next = clone();
    next.chapters[0].title = "The very top";
    next.chapters[0].note = undefined;
    next.chapters[1].footageId = "clip-b";
    next.chapters[2].anchor = { ...next.chapters[2].anchor, atDistanceM: 1_200 };
    expect(checkAdventureEdit(saved, next)).toEqual([]);
  });

  it("refuses to change the recordings an adventure covers", () => {
    const next = clone();
    next.legs = [next.legs[0]];
    expect(checkAdventureEdit(saved, next).join(" ")).toMatch(/legs/);
  });

  it("refuses to change media: media comes only through the importer", () => {
    const next = clone();
    next.footage[0] = { ...next.footage[0], src: "media/other.mp4" };
    expect(checkAdventureEdit(saved, next).join(" ")).toMatch(/footage/);
  });

  it("refuses to change a captured scene's credit", () => {
    const next = clone();
    next.scenes[0].attribution = { ...next.scenes[0].attribution, author: "Someone else" };
    expect(checkAdventureEdit(saved, next).join(" ")).toMatch(/scene/);
  });

  it("refuses to add or remove chapters", () => {
    const next = clone();
    next.chapters.pop();
    expect(checkAdventureEdit(saved, next).join(" ")).toMatch(/chapters/);
  });

  it("refuses to move a chapter to another recording", () => {
    const next = clone();
    next.chapters[1].anchor = { ...next.chapters[1].anchor, slug: "leg-two" };
    expect(checkAdventureEdit(saved, next).join(" ")).toMatch(/recording/);
  });
});
