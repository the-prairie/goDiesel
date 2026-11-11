import { describe, expect, it } from "vitest";

import {
  activityStamp,
  ghostCopy,
  initialAtlasObject,
  reduceAtlasObject,
  routeWear,
  type AtlasObjectState,
} from "@/surfaces/atlas/atlas-object-state";
import type { RouteSummary } from "@/domain/route";

function route(slug: string, lat: number, lng: number): RouteSummary {
  return {
    slug,
    activityId: slug,
    lifecycle: "completed",
    name: slug,
    subtitle: "",
    activityName: slug,
    region: "Crete, Greece",
    date: "2024-12-27",
    distanceKm: 10,
    elevationGainM: 100,
    type: "Run",
    description: "",
    completionRule: "",
    effortTier: "Steady",
    theme: "",
    xp: 0,
    trace: [],
    centerLat: lat,
    centerLng: lng,
    replay: {
      replayMode: "atlas",
      replayEligible: true,
      bestInEarth: false,
      geometryStatus: "ready",
    },
    guide: { reviewStatus: "draft" },
  };
}

const orbit: AtlasObjectState = { phase: "orbit", tuned: "Crete, Greece", gesture: "still" };
const bare: AtlasObjectState = { phase: "orbit", tuned: null, gesture: "still" };

describe("reduceAtlasObject", () => {
  it("tunes in orbit and ignores the same place", () => {
    expect(reduceAtlasObject(bare, { type: "retune", place: "Crete, Greece" })).toEqual(orbit);
    expect(reduceAtlasObject(orbit, { type: "retune", place: "Crete, Greece" })).toBe(orbit);
  });

  it("dives only from a tuned orbit, then lands without a focused ghost", () => {
    expect(reduceAtlasObject(bare, { type: "commit" })).toBe(bare);
    const diving = reduceAtlasObject(orbit, { type: "commit" });
    expect(diving).toEqual({ phase: "diving", place: "Crete, Greece" });
    expect(reduceAtlasObject(diving, { type: "retune", place: "Tokyo, Japan" })).toBe(diving);
    expect(reduceAtlasObject(diving, { type: "arrived" })).toEqual({
      phase: "landed",
      place: "Crete, Greece",
      focus: null,
    });
    expect(reduceAtlasObject(orbit, { type: "arrived" })).toBe(orbit);
  });

  it("focuses one ghost only after landing, and backs out one level at a time", () => {
    const landed = reduceAtlasObject(
      { phase: "diving", place: "Crete, Greece" },
      { type: "arrived" },
    );
    expect(reduceAtlasObject(orbit, { type: "focus", slug: "a" })).toBe(orbit);
    const focused = reduceAtlasObject(landed, { type: "focus", slug: "a" });
    expect(focused).toEqual({ phase: "landed", place: "Crete, Greece", focus: "a" });
    expect(reduceAtlasObject(focused, { type: "focus", slug: "a" })).toBe(focused);
    expect(reduceAtlasObject(focused, { type: "release" })).toEqual(landed);
    expect(reduceAtlasObject(landed, { type: "release" })).toBe(landed);
    expect(reduceAtlasObject(focused, { type: "ascend" })).toEqual(bare);
    expect(reduceAtlasObject(bare, { type: "ascend" })).toBe(bare);
  });

  it("locks a dragged place before it can dive", () => {
    expect(reduceAtlasObject(bare, { type: "drag" })).toEqual({
      phase: "orbit",
      tuned: null,
      gesture: "dragging",
    });
    const dragging = reduceAtlasObject(orbit, { type: "drag" });
    expect(reduceAtlasObject(dragging, { type: "commit" })).toBe(dragging);
    expect(reduceAtlasObject(orbit, { type: "lock" })).toBe(orbit);
    const moved = reduceAtlasObject(dragging, { type: "retune", place: "Tokyo, Japan" });
    expect(moved).toEqual({ phase: "orbit", tuned: "Tokyo, Japan", gesture: "dragging" });
    const locked = reduceAtlasObject(moved, { type: "lock" });
    expect(locked).toEqual({ phase: "orbit", tuned: "Tokyo, Japan", gesture: "still" });
    expect(reduceAtlasObject(locked, { type: "commit" })).toEqual({
      phase: "diving",
      place: "Tokyo, Japan",
    });
    expect(reduceAtlasObject({ phase: "diving", place: "Tokyo, Japan" }, { type: "drag" })).toEqual({
      phase: "diving",
      place: "Tokyo, Japan",
    });
  });

  it("opens on a place when the URL already names one", () => {
    expect(initialAtlasObject(null, null)).toEqual(bare);
    expect(initialAtlasObject("Crete, Greece", "14080158961")).toEqual({
      phase: "landed",
      place: "Crete, Greece",
      focus: "14080158961",
    });
  });
});

describe("routeWear", () => {
  it("brightens a route that shares its ground with others", () => {
    const alone = route("a", 35, 24);
    const cluster = [
      route("a", 35.2, 24.1),
      route("b", 35.21, 24.11),
      route("c", 35.22, 24.12),
      route("d", 35.23, 24.09),
    ];
    expect(routeWear(alone, [alone])).toBe(1);
    expect(routeWear(cluster[0], cluster.slice(0, 2))).toBe(2);
    expect(routeWear(cluster[0], cluster)).toBe(3);
  });
});

describe("ghostCopy", () => {
  it("gives two activities on the same day different stamps", () => {
    const first = route("14080158961", 35.2, 24.1);
    const second = { ...route("14080158962", 35.21, 24.11), date: "2024-12-27" };
    expect(activityStamp(first, [first, second])).toBe("2024-12-27 · 1");
    expect(activityStamp(second, [first, second])).toBe("2024-12-27 · 2");
    expect(activityStamp(first, [first])).toBe("2024-12-27");
  });

  it("uses a clock when the record has one, and a short title when one exists", () => {
    const timed = { ...route("a", 1, 2), date: "2024-12-27T18:40:00" };
    const other = { ...route("b", 1, 2), date: "2024-12-27T07:05:00" };
    expect(activityStamp(timed, [timed, other])).toBe("2024-12-27 18:40");
    const titled = {
      ...route("c", 1, 2),
      name: "DONT EVER, FOR ANY REASON, DO ANYTHING, TO ANYONE",
      subtitle: "the long way home",
    };
    expect(ghostCopy(titled, [titled]).heading).toBe("the long way home");
    expect(ghostCopy(titled, [titled]).detail).toBe(titled.name);
    expect(ghostCopy(route("d", 1, 2), [route("d", 1, 2)]).heading).toBe("2024-12-27 · 10.0 km · 100 m");
  });
});
