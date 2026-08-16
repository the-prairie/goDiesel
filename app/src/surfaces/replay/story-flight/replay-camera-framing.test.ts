import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import {
  frameReplayCamera,
  replaySubjectBand,
  type ReplayViewportInsets,
} from "@/surfaces/replay/story-flight/replay-camera-framing";

const route = {
  distanceKm: 2,
  route: [
    { lat: 51, lng: -1, elev: 20, d: 0 },
    { lat: 51.01, lng: -0.99, elev: 40, d: 2_000 },
  ],
} as QuestRoute;

const pose: GoogleRouteCameraPose = {
  center: { lat: 51.008, lng: -0.992, altitude: 90 },
  directedMode: "chase",
  fovDeg: 45,
  headingDeg: 20,
  progressM: 1_000,
  rangeM: 500,
  tiltDeg: 58,
};

const viewport: ReplayViewportInsets = {
  bottom: 180,
  chromeVisible: true,
  height: 900,
  left: 0,
  right: 0,
  top: 64,
  width: 1_440,
};

describe("Replay camera framing", () => {
  it("pulls a tracked subject away from an occupied lower HUD", () => {
    const framed = frameReplayCamera(route, pose, viewport);

    expect(framed.center.lat).toBeLessThan(pose.center.lat);
    expect(framed.center.lng).toBeLessThan(pose.center.lng);
    expect(framed.rangeM).toBeGreaterThan(pose.rangeM);
    expect(framed.tiltDeg).toBeLessThan(pose.tiltDeg);
  });

  it("leaves overview direction untouched", () => {
    const overview = { ...pose, directedMode: "overview" as const };
    expect(frameReplayCamera(route, overview, viewport)).toBe(overview);
  });

  it("reports the visible terrain band between chrome surfaces", () => {
    const band = replaySubjectBand(viewport);
    expect(band.minimumY).toBeGreaterThan(viewport.top);
    expect(band.maximumY).toBeLessThan(viewport.height - viewport.bottom);
    expect(band.maximumY).toBeGreaterThan(band.minimumY);
  });
});
