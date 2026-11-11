import { describe, expect, it } from "vitest";

import {
  initialReplaySurfaceState,
  reduceReplaySurface,
  replaySurfaceMatches,
} from "@/surfaces/replay/playback/replay-surface-state";

function open(renderer: string | null, routeSlug = "kyoto") {
  return initialReplaySurfaceState(renderer, routeSlug);
}

describe("replay surface choice", () => {
  it("opens Google, Atlas, or Cesium from the renderer query", () => {
    expect(open(null)).toEqual({ routeSlug: "kyoto", kind: "google" });
    expect(open("atlas")).toEqual({ routeSlug: "kyoto", kind: "atlas", reason: "requested" });
    expect(open("cesium")).toEqual({ routeSlug: "kyoto", kind: "cesium" });
    expect(open("other").kind).toBe("google");
  });

  it("uses Atlas after Google reports that it cannot start", () => {
    const google = open(null);
    const degraded = reduceReplaySurface(google, { type: "googleDegraded" });
    expect(degraded).toEqual({ routeSlug: "kyoto", kind: "atlas", reason: "degraded" });
    expect(reduceReplaySurface(degraded, { type: "googleDegraded" })).toBe(degraded);
    expect(replaySurfaceMatches(degraded, null, "kyoto")).toBe(true);
  });

  it("does not degrade a renderer the query already chose", () => {
    for (const renderer of ["atlas", "cesium"] as const) {
      const state = open(renderer);
      expect(reduceReplaySurface(state, { type: "googleDegraded" })).toBe(state);
    }
  });

  it("applies a renderer query change before the next effect", () => {
    const google = reduceReplaySurface(open("atlas"), {
      type: "paramsChanged",
      renderer: null,
      routeSlug: "kyoto",
    });
    expect(google).toEqual({ routeSlug: "kyoto", kind: "google" });
  });

  it("keeps a Google fallback on the same route and clears it for the next route", () => {
    const degraded = reduceReplaySurface(open(null), { type: "googleDegraded" });
    expect(
      reduceReplaySurface(degraded, { type: "paramsChanged", renderer: null, routeSlug: "kyoto" }),
    ).toBe(degraded);
    expect(
      reduceReplaySurface(degraded, { type: "paramsChanged", renderer: null, routeSlug: "osaka" }),
    ).toEqual({ routeSlug: "osaka", kind: "google" });
  });

  it("lets Cesium replace a Google fallback in the same update", () => {
    const degraded = reduceReplaySurface(open(null), { type: "googleDegraded" });
    expect(
      reduceReplaySurface(degraded, { type: "paramsChanged", renderer: "cesium", routeSlug: "kyoto" }),
    ).toEqual({ routeSlug: "kyoto", kind: "cesium" });
  });
});
