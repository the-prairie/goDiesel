import { describe, expect, it } from "vitest";
import { planWorldLookAhead } from "./world-look-ahead";
import type { QuestRoute } from "@/domain/route";
import type { WorldPlaybackContext } from "./world-diagnostics";
import { initialGoogleRouteNavigatorState } from "../playback/route-navigator-controller";
const route = { distanceKm: 15.1, route: [{d:0}, {d:15100}], provenance: { discontinuities: [] } } as unknown as QuestRoute;
const context: WorldPlaybackContext = { ...initialGoogleRouteNavigatorState(), progressM: 9800, playing: true, cameraMode: "runner", cameraSettling: false, settingsOpen: false, reducedMotion: false };
describe("route-aware loading", () => {
  it("prepares a bounded 1.5 seconds of recorded travel, not the entire route", () => {
    expect(planWorldLookAhead(route, context, 179, 0, 0.5, false)).toMatchObject({ progressM: 9907.857142857143, radiusM: 71.60000000000001, mode: "ahead" });
    expect(planWorldLookAhead(route, {...context, speed:4}, 1800, 0, 0.5, false)).toMatchObject({ progressM: 10120, radiusM:180 });
  });
  it("seeks prioritize the final destination rather than an imaginary corridor", () => {
    expect(planWorldLookAhead(route, {...context, playing:false}, 179, 0, 0.5, true)?.progressM).toBe(9800);
  });
  it("yields to the real view under decode/memory pressure, pauses and free camera", () => {
    expect(planWorldLookAhead(route, context, 179, 16, 0.5, false)).toBeNull();
    expect(planWorldLookAhead(route, context, 179, 0, 0.93, false)).toBeNull();
    expect(planWorldLookAhead(route, {...context, playing:false}, 179, 0, 0.5, false)).toBeNull();
    expect(planWorldLookAhead(route, {...context, following:false}, 179, 0, 0.5, true)).toBeNull();
    expect(planWorldLookAhead(route, context, 10_000, 0, 0.5, false)).toBeNull();
  });
  it("does not invent a sea-level prefetch corridor for missing elevations", () => {
    expect(planWorldLookAhead({...route,elevationStatus:"unavailable"}, context,179,0,0.5,false)).toBeNull();
  });
  it("never predicts through an actual recording gap", () => {
    for (const endD of [9850,9900]) {
      const broken = { ...route, provenance: {...route.provenance, discontinuities: [{startD:9850,endD}]} } as QuestRoute;
      expect(planWorldLookAhead(broken, context, 179, 0, 0.5, false)).toBeNull();
    }
  });
});
