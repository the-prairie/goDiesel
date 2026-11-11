import { describe, expect, it } from "vitest";
import type { FinderIntent } from "@/domain/planning";
import { activeFilterChips } from "./finder-filter-chips";

const intent: FinderIntent = {
  place: "",
  activity: "Run",
  distanceKm: 15,
  explicitFilters: [],
  terrain: "any",
  vibe: "",
};

describe("Finder active filter chips", () => {
  it("shows the person's free-text search exactly as typed", () => {
    const [chip] = activeFilterChips({ ...intent, query: "a hilly run in Crete about 15 km" });
    expect(chip).toEqual({
      key: "query",
      label: "a hilly run in Crete about 15 km",
      aria: "Clear experience search",
      capitalize: false,
    });
  });

  it("keeps typed place and vibe verbatim and capitalises only the terrain choice", () => {
    const chips = activeFilterChips({ ...intent, place: "iOS beach", vibe: "quiet and early", terrain: "mixed" });
    expect(chips.map(({ key, label, capitalize }) => ({ key, label, capitalize }))).toEqual([
      { key: "place", label: "iOS beach", capitalize: false },
      { key: "terrain", label: "mixed", capitalize: true },
      { key: "vibe", label: "quiet and early", capitalize: false },
    ]);
  });

  it("omits a search that only repeats the place", () => {
    expect(activeFilterChips({ ...intent, place: "Kyoto, Japan", query: "Kyoto, Japan" }).map((chip) => chip.key)).toEqual(["place"]);
  });
});
