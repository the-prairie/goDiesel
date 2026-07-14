import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  advanceReplay,
  cycleReplaySpeed,
  initialReplayState,
  replayPose,
  routeDistanceM,
  seekReplay,
  toggleReplay,
  toggleReplayFollowing,
  zoomReplay,
} from "@/replay/replay-controller";

const route = {
  distanceKm: 1,
  route: [
    { lat: 51, lng: -114, elev: 100, d: 0 },
    { lat: 51.005, lng: -114, elev: 120, d: 500 },
    { lat: 51.01, lng: -114, elev: 140, d: 1_000 },
  ],
} as QuestRoute;

describe("Replay controller", () => {
  it("advances only while playing and stops at the route end", () => {
    const totalDistanceM = routeDistanceM(route);
    const initial = initialReplayState();
    expect(advanceReplay(initial, 1, totalDistanceM)).toEqual(initial);

    const playing = toggleReplay(initial);
    const advanced = advanceReplay(playing, 0.1, totalDistanceM);
    expect(advanced.progressM).toBeGreaterThan(0);
    expect(advanced.playing).toBe(true);

    expect(
      advanceReplay(
        { ...initialReplayState(), playing: true, progressM: 999.9 },
        10,
        totalDistanceM,
      ),
    ).toMatchObject({ playing: false, progressM: totalDistanceM });
  });

  it("interpolates a synchronized position and bearing", () => {
    const pose = replayPose(route, {
      ...initialReplayState(),
      progressM: 250,
    });
    expect(pose.lat).toBeCloseTo(51.0025);
    expect(pose.lng).toBeCloseTo(-114);
    expect(pose.elev).toBeCloseTo(110);
    expect(pose.progressRatio).toBeCloseTo(0.25);
    expect(pose.bearingDeg).toBeCloseTo(0);
  });

  it("seeks, changes pace, releases follow, and changes route framing", () => {
    const initial = initialReplayState();
    const seeked = seekReplay(initial, 750, 1_000);
    expect(seeked.progressM).toBe(750);
    expect(cycleReplaySpeed(seeked).speed).toBe(2);
    expect(toggleReplayFollowing(seeked).following).toBe(false);
    expect(zoomReplay(seeked, "out").cameraRangeM).toBe(720);
    expect(zoomReplay(seeked, "in").cameraRangeM).toBe(120);
  });
});
