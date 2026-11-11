import { describe, expect, it } from "vitest";

import {
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

const orbit: AtlasObjectState = { phase: "orbit", tuned: "Crete, Greece" };
const bare: AtlasObjectState = { phase: "orbit", tuned: null };

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
