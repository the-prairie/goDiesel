import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  cinematicDuration,
  cinematicFrame,
  cinematicMoments,
  cinematicProfile,
  cinematicShotTimeline,
  type CinematicCut,
} from "@/replay/cinematic/route-cinematic-director";

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

describe("route cinematic director", () => {
  it("finds recorded dramatic moments", () => {
    const moments = cinematicMoments(route);
    expect(moments.map((moment) => moment.kind)).toEqual([
      "origin",
      "climb",
      "turn",
      "summit",
      "arrival",
    ]);
    expect(
      moments.find((moment) => moment.kind === "summit")?.progressRatio,
    ).toBeCloseTo(0.4);
  });

  it("derives a terrain profile from recorded geometry", () => {
    const profile = cinematicProfile(route);
    expect(profile.reliefM).toBe(240);
    expect(profile.positiveGainM).toBe(240);
    expect(profile.maximumGradePct).toBeGreaterThan(6);
    expect(profile.turningIntensityDeg).toBeGreaterThan(80);
    expect(profile.character).toBe("rolling");
  });

  it("publishes exact shot boundaries for deterministic preflight", () => {
    const timeline = cinematicShotTimeline(route, "feature");
    expect(timeline.length).toBeGreaterThanOrEqual(5);
    expect(timeline[0]).toMatchObject({
      kind: "establishing",
      startSeconds: 0,
    });
    expect(timeline.at(-1)?.kind).toBe("release");
    expect(timeline.at(-1)?.endSeconds).toBeCloseTo(
      cinematicDuration(route, "feature"),
    );
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index].startSeconds).toBeCloseTo(
        timeline[index - 1].endSeconds,
      );
    }
  });

  it("adds clearance and pitch when recorded terrain is steep", () => {
    const openRoute = {
      ...route,
      route: route.route.map((point) => ({ ...point, elev: 20 })),
    } as QuestRoute;
    const mountainRoute = {
      ...route,
      route: route.route.map((point, index) => ({
        ...point,
        elev: [20, 300, 740, 1_020, 640, 120][index],
      })),
    } as QuestRoute;
    const openTracking = cinematicFrame(openRoute, "feature", 16);
    const mountainTracking = cinematicFrame(mountainRoute, "feature", 16);
    expect(cinematicProfile(openRoute).character).toBe("open");
    expect(cinematicProfile(mountainRoute).character).toBe("mountain");
    expect(mountainTracking.rangeM).toBeGreaterThan(openTracking.rangeM);
    expect(mountainTracking.pitchDeg).toBeLessThan(openTracking.pitchDeg);
  });

  it.each([
    "feature",
    "monumental",
    "kinetic",
    "intimate",
  ] satisfies CinematicCut[])(
    "produces a complete %s cut",
    (cut) => {
      const duration = cinematicDuration(route, cut);
      const opening = cinematicFrame(route, cut, 0);
      const ending = cinematicFrame(route, cut, duration);
      expect(duration).toBeGreaterThan(15);
      expect(opening.progress).toBe(0);
      expect(ending.progress).toBe(1);
      expect(ending.showDecision).toBe(true);
      expect(ending.routeProgressM).toBe(10_000);
      expect(ending.threadStartRatio).toBeLessThanOrEqual(1);
      expect(ending.threadEndRatio).toBe(1);
    },
  );

  it("gives each cut a distinct visual and camera language", () => {
    const feature = cinematicFrame(route, "feature", 14);
    const monumental = cinematicFrame(route, "monumental", 10);
    const kinetic = cinematicFrame(route, "kinetic", 5);
    const intimate = cinematicFrame(route, "intimate", 8);
    expect(monumental.look.saturation).toBeLessThan(kinetic.look.saturation);
    expect(intimate.look.depthOfField).toBeGreaterThan(0);
    expect(intimate.rangeM).toBeLessThan(monumental.rangeM);
    expect(feature.shotCount).toBeGreaterThanOrEqual(5);
    expect(feature.lensMm).toBeGreaterThan(50);
  });

  it("directs route-derived editorial acts with real cuts", () => {
    const duration = cinematicDuration(route, "feature");
    const opening = cinematicFrame(route, "feature", 2);
    const frames = Array.from({ length: 300 }, (_, index) =>
      cinematicFrame(route, "feature", (duration * index) / 299),
    );
    expect(new Set(frames.map((frame) => frame.chapter)).size).toBeGreaterThan(
      5,
    );
    expect(opening.threadEndRatio).toBe(0);
    expect(Math.min(...frames.map((frame) => frame.lensMm))).toBeLessThan(35);
    expect(Math.max(...frames.map((frame) => frame.lensMm))).toBeGreaterThan(80);
    expect(frames.filter((frame) => frame.cutPulse > 0.7).length).toBeGreaterThan(
      4,
    );
    expect(new Set(frames.map((frame) => frame.shotKind)).size).toBeGreaterThan(
      3,
    );
    expect(
      new Set(frames.map((frame) => frame.cameraResponseSeconds)).size,
    ).toBeGreaterThan(2);
    expect(opening.chapter).toBe("A day waits out there");
    expect(opening.chapterSubtitle).toContain("10.0 kilometres");
    expect(
      frames.every((frame) => frame.chapterSubtitle.length > 24),
    ).toBe(true);
  });

  it("keeps adjacent camera targets on a stable spatial rail", () => {
    const frames = Array.from({ length: 70 }, (_, index) =>
      cinematicFrame(route, "kinetic", 0.15 + index / 30),
    );
    const targetStepsM = frames.slice(1).map((frame, index) => {
      const previous = frames[index];
      const northM = (frame.target.lat - previous.target.lat) * 111_320;
      const eastM =
        (frame.target.lng - previous.target.lng) *
        111_320 *
        Math.cos((frame.target.lat * Math.PI) / 180);
      return Math.hypot(northM, eastM);
    });
    expect(Math.max(...targetStepsM)).toBeLessThan(95);
  });
});
