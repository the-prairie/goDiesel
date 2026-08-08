import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { cinematicSoundMix } from "@/surfaces/replay/cinematic/cinematic-soundscape";
import { cinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";

const route = {
  distanceKm: 10,
  centerLat: 35,
  centerLng: 24,
  route: [
    { lat: 35, lng: 24, elev: 20, d: 0 },
    { lat: 35.01, lng: 24, elev: 120, d: 2_000 },
    { lat: 35.01, lng: 24.02, elev: 260, d: 4_000 },
    { lat: 35.03, lng: 24.02, elev: 180, d: 6_000 },
    { lat: 35.03, lng: 24.04, elev: 80, d: 8_000 },
    { lat: 35.05, lng: 24.04, elev: 40, d: 10_000 },
  ],
} as QuestRoute;

describe("cinematic sound mix", () => {
  it("responds to the camera and editorial act", () => {
    const opening = cinematicSoundMix(cinematicFrame(route, "feature", 1));
    const effort = cinematicSoundMix(cinematicFrame(route, "feature", 16));
    expect(effort.windGain).toBeGreaterThan(opening.windGain);
    expect(effort.scoreGain).toBeGreaterThan(opening.scoreGain);
    expect(effort.rootHz).not.toBe(opening.rootHz);
  });

  it("creates a bounded stereo field from camera direction", () => {
    const mix = cinematicSoundMix(cinematicFrame(route, "kinetic", 8));
    expect(mix.pan).toBeGreaterThanOrEqual(-0.6);
    expect(mix.pan).toBeLessThanOrEqual(0.6);
  });
});
