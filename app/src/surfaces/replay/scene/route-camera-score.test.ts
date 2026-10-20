import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRouteDetail } from "@/domain/route";
import { googleRouteCameraPose, initialGoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";
import { sustainedRouteCamera } from "./route-camera-score";

const loadRoute = (slug: string) => parseRouteDetail(JSON.parse(readFileSync(`public/data/routes/${slug}.json`, "utf8")));
const route = loadRoute("14736711660");
const stateAt = (progressM: number) => ({ ...initialGoogleRouteNavigatorState(), progressM });
const poseAt = (progressM: number, width = 390) => {
  const state = stateAt(progressM);
  return sustainedRouteCamera(route, state, googleRouteCameraPose(route, state), width);
};
const angle = (a: number, b: number) => ((a - b + 540) % 360) - 180;

describe("authored San Francisco opening", () => {
  it.each([390, 1440])("holds lens distance and tilt throughout the first minute at width %s", width => {
    const first = poseAt(0, width);
    for (let distance = 0; distance <= 1800; distance += 10) {
      const pose = poseAt(distance, width);
      expect(pose.rangeM).toBe(first.rangeM);
      expect(pose.tiltDeg).toBe(first.tiltDeg);
      expect(pose.progressM).toBe(distance);
      expect(pose.clearanceM!).toBeGreaterThanOrEqual(pose.minimumClearanceM!);
    }
  });

  it("holds an orientation on each long street and turns in one direction between them", () => {
    expect(poseAt(0).headingDeg).toBe(poseAt(550).headingDeg);
    expect(poseAt(1200).headingDeg).toBe(poseAt(1800).headingDeg);
    for (let distance = 610; distance <= 1100; distance += 10) {
      expect(angle(poseAt(distance).headingDeg, poseAt(distance - 10).headingDeg)).toBeLessThanOrEqual(0);
    }
  });

  it("selects identical shots after seeking, pausing, or changing playback speed", () => {
    const state = stateAt(900);
    const base = googleRouteCameraPose(route, state);
    const expected = sustainedRouteCamera(route, state, base, 390);
    for (const speed of [1, 2, 4, 8]) {
      for (const playing of [true, false]) {
        expect(sustainedRouteCamera(route, { ...state, speed, playing }, base, 390)).toEqual(expected);
      }
    }
    poseAt(2400);
    expect(poseAt(900)).toEqual(expected);
  });

  it("rejoins normal Auto continuously at the end of the authored section", () => {
    for (const boundary of [600, 1100, 1900, 2100]) {
      const before = poseAt(boundary - .01);
      const after = poseAt(boundary + .01);
      expect(Math.abs(angle(after.headingDeg, before.headingDeg))).toBeLessThan(.05);
      expect(Math.abs(after.rangeM - before.rangeM)).toBeLessThan(.1);
      expect(Math.abs(after.tiltDeg - before.tiltDeg)).toBeLessThan(.01);
    }
    for (const progressM of [2100, 10_990, 28_500]) {
      const state = stateAt(progressM);
      const base = googleRouteCameraPose(route, state);
      expect(sustainedRouteCamera(route, state, base, 390)).toBe(base);
    }
  });

  it.each(["9953403673", "14023448720"])("does not apply the authored score to %s", slug => {
    const source = loadRoute(slug);
    const state = stateAt(500);
    const base = googleRouteCameraPose(source, state);
    expect(sustainedRouteCamera(source, state, base, 390)).toBe(base);
  });

  it("leaves manual modes and routes with recording gaps to their existing camera", () => {
    for (const cameraMode of ["runner", "chase", "overview"] as const) {
      const state = { ...stateAt(500), cameraMode };
      const base = googleRouteCameraPose(route, state);
      expect(sustainedRouteCamera(route, state, base, 390)).toBe(base);
    }
    const interrupted = structuredClone(route);
    interrupted.provenance.discontinuities = [{ kind: "recording_gap", source: "recorded_timestamps", startD: 200, endD: 400 }];
    const state = stateAt(100);
    const base = googleRouteCameraPose(interrupted, state);
    expect(sustainedRouteCamera(interrupted, state, base, 390)).toBe(base);
  });

  it("honours zoom while retaining the recorded terrain clearance floor", () => {
    for (const rangeScale of [.55, 1, 1.8, 2.4]) {
      for (const progressM of [0, 200, 1000, 1800]) {
        const state = { ...stateAt(progressM), rangeScale };
        const base = googleRouteCameraPose(route, state);
        const pose = sustainedRouteCamera(route, state, base, 390);
        expect(pose.rangeM).toBe(Math.min(900, Math.max(390, poseAt(progressM).rangeM * rangeScale)));
        expect(pose.clearanceM!).toBeGreaterThanOrEqual(pose.minimumClearanceM!);
      }
    }
  });

  it("preserves the recorded route and telemetry inputs", () => {
    const snapshot = structuredClone(route);
    for (const progressM of [0, 500, 1000, 1700, 2300]) {
      const state = stateAt(progressM);
      const base = googleRouteCameraPose(route, state);
      const snapshotBase = structuredClone(base);
      const pose = sustainedRouteCamera(route, state, base, 390);
      expect(pose.progressM).toBe(base.progressM);
      expect(base).toEqual(snapshotBase);
    }
    expect(route).toEqual(snapshot);
  });
});
