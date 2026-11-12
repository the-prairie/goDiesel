import { describe, expect, it } from "vitest";

import { GOOGLE_ROUTE_REPLAY_DURATION_SECONDS } from "@/surfaces/replay/playback/route-navigator-controller";
import { WALK_FPS, walkFrame } from "@/labs/overland/model/walk-cycle";

const TOTAL = 10_500;
// At normal speed the replay covers this much of the route each second.
const PER_SECOND = TOTAL / GOOGLE_ROUTE_REPLAY_DURATION_SECONDS;

describe("walkFrame", () => {
  it("stands on the first frame at the start", () => {
    expect(walkFrame({ progressM: 0, totalDistanceM: TOTAL, frames: 4, reducedMotion: false })).toBe(0);
  });

  it("steps about eight frames a second at normal playback speed", () => {
    expect(WALK_FPS).toBe(8);
    const seen: number[] = [];
    for (let tick = 0; tick < WALK_FPS; tick += 1) {
      seen.push(walkFrame({ progressM: ((tick + 0.5) / WALK_FPS) * PER_SECOND, totalDistanceM: TOTAL, frames: 4, reducedMotion: false }));
    }
    expect(seen).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it("holds its frame while the progress holds, so a paused runner stands still", () => {
    const at = { progressM: 1234, totalDistanceM: TOTAL, frames: 4, reducedMotion: false };
    expect(walkFrame(at)).toBe(walkFrame({ ...at }));
  });

  it("never animates with reduced motion", () => {
    for (const progressM of [0, 7, 99, 5000]) {
      expect(walkFrame({ progressM, totalDistanceM: TOTAL, frames: 4, reducedMotion: true })).toBe(0);
    }
  });

  it("survives a route of no length", () => {
    expect(walkFrame({ progressM: 0, totalDistanceM: 0, frames: 4, reducedMotion: false })).toBe(0);
  });
});
