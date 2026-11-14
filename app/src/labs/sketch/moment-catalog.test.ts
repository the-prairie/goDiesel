import { describe, expect, it } from "vitest";

import { EXAMPLE_MOMENTS, approachCamera, chooseMoments, emptyPlacement, placementsOf, placeMoment, shownMoments, swapPlacement, unplaceEntry, type MomentsData } from "@/labs/sketch/moment-catalog";

const data: MomentsData = {
  catalog: [
    { id: "tv-a", kind: "tv-wall", title: "First clip", clip: "/moments/a.mp4" },
    { id: "tv-b", kind: "tv-wall", title: "Second clip", clip: "/moments/b.mp4", caption: "A line" },
  ],
  placements: [{ id: "p1", entryId: "tv-a", at: { lng: 135.77, lat: 35 }, facingDeg: 185 }],
};

describe("the example moments (committed)", () => {
  it("holds one no-signal entry with no clip, placed once beside route 064", () => {
    expect(EXAMPLE_MOMENTS.catalog).toEqual([{ id: "no-signal", kind: "tv-wall", title: "No signal (example)", clip: null }]);
    expect(EXAMPLE_MOMENTS.placements).toHaveLength(1);
    expect(EXAMPLE_MOMENTS.placements[0].entryId).toBe("no-signal");
  });
});

describe("catalog and placements", () => {
  it("shows each placed entry where it stands", () => {
    expect(shownMoments(data)).toEqual([{ placement: data.placements[0], entry: data.catalog[0] }]);
  });

  it("places an entry at a new spot, and the same entry in more than one", () => {
    const next = placeMoment(data, { id: "p2", entryId: "tv-a", at: { lng: 135.78, lat: 35.01 }, facingDeg: 90 });
    expect(placementsOf(next, "tv-a").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(placementsOf(next, "tv-b")).toEqual([]);
  });

  it("swaps a place to another entry, or empties it", () => {
    expect(shownMoments(swapPlacement(data, "p1", "tv-b"))[0].entry.id).toBe("tv-b");
    const emptied = emptyPlacement(data, "p1");
    expect(emptied.placements[0].entryId).toBeNull();
    expect(shownMoments(emptied)).toEqual([]);
  });

  it("unplaces an entry from everywhere it stands, leaving the catalog alone", () => {
    const next = unplaceEntry(placeMoment(data, { id: "p2", entryId: "tv-a", at: { lng: 1, lat: 1 }, facingDeg: 0 }), "tv-a");
    expect(next.placements).toEqual([]);
    expect(next.catalog).toEqual(data.catalog);
  });

  it("shows nothing for a placement whose entry has gone, rather than failing", () => {
    expect(shownMoments({ ...data, catalog: [data.catalog[1]] })).toEqual([]);
  });

  it("keeps an entry whose clip is missing, to show no signal", () => {
    const noClip = { ...data, catalog: [{ ...data.catalog[0], clip: null }] };
    expect(shownMoments(noClip)[0].entry.clip).toBeNull();
  });

  it("uses her private catalog and placements when both are present, the example otherwise", () => {
    expect(chooseMoments(data)).toBe(data);
    expect(chooseMoments(null)).toBe(EXAMPLE_MOMENTS);
    expect(chooseMoments({ catalog: "nope" } as unknown as MomentsData)).toBe(EXAMPLE_MOMENTS);
  });
});

describe("approachCamera", () => {
  const placement = { at: { lng: 135.77, lat: 35.0 }, facingDeg: 185 };

  it("stands in the street looking at the shop's front, low and close", () => {
    const camera = approachCamera(placement);
    expect(camera.bearing).toBeCloseTo(5, 6);
    expect(camera.pitch).toBeGreaterThanOrEqual(65);
    expect(camera.zoom).toBeGreaterThanOrEqual(18);
    expect(camera.center[1]).toBeLessThan(35.0);
  });

  it("turns with the shop", () => {
    expect(approachCamera({ ...placement, facingDeg: 90 }).bearing).toBeCloseTo(270, 6);
    expect(approachCamera({ ...placement, facingDeg: 270 }).bearing).toBeCloseTo(90, 6);
  });
});
