import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import {
  createRouteSceneManifest,
  resolveRouteSceneFrame,
} from "@/surfaces/replay/scene/route-scene-contract";

const route = {
  slug: "test-route",
  activityId: "123",
  name: "Test route",
  region: "Test region",
  type: "Run",
  distanceKm: 2,
  elevationGainM: 20,
  centerLat: 51,
  centerLng: -1,
  route: [
    { lat: 51, lng: -1, elev: 20, d: 0, elapsedS: 0 },
    { lat: 51, lng: -0.99, elev: 30, d: 800, elapsedS: 240 },
    { lat: 51.01, lng: -0.99, elev: 40, d: 2_000, elapsedS: 600 },
  ],
  provenance: {
    temporal: { status: "recorded", elapsedTimeS: 600 },
    track: { segmentCount: 1 },
    discontinuities: [],
  },
} as unknown as QuestRoute;

describe("route scene contract", () => {
  it("preserves recorded route geometry and provenance", () => {
    const manifest = createRouteSceneManifest(route);

    expect(manifest.id).toBe("test-route");
    expect(manifest.totalDistanceM).toBe(2_000);
    expect(manifest.path).toHaveLength(3);
    expect(manifest.path[1]).toMatchObject({
      progressM: 800,
      elevationM: 30,
      elapsedS: 240,
    });
    expect(manifest.altitudeSource).toBe("recorded-activity");
  });

  it("resolves one chase frame for every renderer", () => {
    const frame = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "chase",
      following: true,
      progressM: 1_000,
      rangeScale: 1,
    });

    expect(frame.subject.progressM).toBeCloseTo(1_000);
    expect(frame.camera.rangeM).toBe(260);
    expect(frame.camera.target.lat).toBeCloseTo(51.00242, 4);
    expect(frame.camera.target.lng).toBeCloseTo(-0.99, 4);
    expect(frame.camera.target.altitude).toBeCloseTo(42.42, 1);
    expect(frame.telemetry.elapsedS).toBeCloseTo(300);
    expect(frame.telemetry.elevationM).toBeCloseTo(31.67, 1);
    expect(frame.rendererPose.cameraRangeM).toBe(260);
    expect(frame.rendererPose.following).toBe(true);
  });

  it("keeps overview framing route-wide", () => {
    const frame = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "overview",
      following: true,
      progressM: 500,
      rangeScale: 1,
    });

    expect(frame.camera.target).toMatchObject({ lat: 51, lng: -1 });
    expect(frame.camera.target.altitude).toBeCloseTo(31.67, 1);
    expect(frame.camera.rangeM).toBeGreaterThanOrEqual(1_400);
  });

  it("keeps chase targets smooth and safely above recorded terrain", () => {
    const beforeTurn = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "chase",
      following: true,
      progressM: 760,
      rangeScale: 1,
    });
    const afterTurn = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "chase",
      following: true,
      progressM: 840,
      rangeScale: 1,
    });
    const northM =
      (afterTurn.camera.target.lat - beforeTurn.camera.target.lat) * 111_320;
    const eastM =
      (afterTurn.camera.target.lng - beforeTurn.camera.target.lng) *
      111_320 *
      Math.cos((afterTurn.camera.target.lat * Math.PI) / 180);

    expect(Math.hypot(northM, eastM)).toBeLessThan(120);
    expect(beforeTurn.camera.target.altitude).toBeGreaterThan(
      beforeTurn.subject.elevationM,
    );
    expect(afterTurn.camera.target.altitude).toBeGreaterThan(
      afterTurn.subject.elevationM,
    );
  });

  it("keeps the runner camera above coarse photogrammetry", () => {
    const frame = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "runner",
      following: true,
      progressM: 800,
      rangeScale: 1,
    });

    expect(frame.camera.target.altitude - frame.subject.elevationM).toBeGreaterThan(21);
    expect(frame.camera.rangeM).toBeGreaterThanOrEqual(150);
    expect(frame.camera.tiltDeg).toBeLessThanOrEqual(65);
    expect(frame.camera.fovDeg).toBeLessThanOrEqual(50);
  });

  it("directs an automatic reveal into a protected chase view", () => {
    const manifest = createRouteSceneManifest(route);
    const reveal = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 0,
      rangeScale: 1,
    });
    const tracking = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 1_000,
      rangeScale: 1,
    });

    expect(reveal.camera.directedMode).toBe("overview");
    expect(reveal.camera.rangeM).toBeGreaterThan(1_000);
    expect(tracking.camera.directedMode).toBe("chase");
    expect(tracking.camera.rangeM).toBeGreaterThanOrEqual(390);
    expect(tracking.camera.tiltDeg).toBeLessThanOrEqual(58);
    expect(
      tracking.camera.rangeM *
        Math.cos((tracking.camera.tiltDeg * Math.PI) / 180),
    ).toBeGreaterThanOrEqual(200);
    expect(tracking.camera.protection).toContain("recorded-terrain-envelope");
    expect(tracking.camera.target.altitude).toBeGreaterThan(
      tracking.subject.elevationM + 15,
    );
  });

  it("keeps automatic zoom inside the protected tracking envelope", () => {
    const manifest = createRouteSceneManifest(route);
    const close = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 1_000,
      rangeScale: 0.55,
    });
    const far = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 1_000,
      rangeScale: 2.4,
    });

    expect(close.camera.rangeM).toBeGreaterThanOrEqual(390);
    expect(far.camera.rangeM).toBeLessThanOrEqual(900);
  });

  it("keeps adjacent automatic camera frames continuous", () => {
    const manifest = createRouteSceneManifest(route);
    const before = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 995,
      rangeScale: 1,
    });
    const after = resolveRouteSceneFrame(manifest, {
      cameraMode: "auto",
      following: true,
      progressM: 1_005,
      rangeScale: 1,
    });

    expect(Math.abs(after.camera.rangeM - before.camera.rangeM)).toBeLessThan(12);
    expect(Math.abs(after.camera.tiltDeg - before.camera.tiltDeg)).toBeLessThan(2);
    expect(Math.abs(after.camera.target.altitude - before.camera.target.altitude)).toBeLessThan(8);
  });

  it("bounds camera acceleration across recorded route vertices", () => {
    const cornerRoute = {
      ...route,
      distanceKm: 0.5,
      route: [
        { lat: 51, lng: -1, elev: 20, d: 0, elapsedS: 0 },
        { lat: 51, lng: -0.9986, elev: 21, d: 100, elapsedS: 30 },
        { lat: 51.0009, lng: -0.9986, elev: 22, d: 200, elapsedS: 60 },
        { lat: 51.0009, lng: -0.9972, elev: 23, d: 300, elapsedS: 90 },
        { lat: 51.0018, lng: -0.9972, elev: 24, d: 400, elapsedS: 120 },
        { lat: 51.0018, lng: -0.9958, elev: 25, d: 500, elapsedS: 150 },
      ],
    } as unknown as QuestRoute;
    const manifest = createRouteSceneManifest(cornerRoute);
    const targets = Array.from({ length: 21 }, (_, index) =>
      resolveRouteSceneFrame(manifest, {
        cameraMode: "auto",
        following: true,
        progressM: 80 + index * 4,
        rangeScale: 1,
      }).camera.target,
    );
    const displacements = targets.slice(1).map((target, index) => {
      const previous = targets[index];
      return {
        eastM:
          (target.lng - previous.lng) *
          111_320 *
          Math.cos((target.lat * Math.PI) / 180),
        northM: (target.lat - previous.lat) * 111_320,
      };
    });
    const peakAccelerationM = Math.max(
      ...displacements.slice(1).map((step, index) =>
        Math.hypot(
          step.eastM - displacements[index].eastM,
          step.northM - displacements[index].northM,
        ),
      ),
    );

    expect(peakAccelerationM).toBeLessThan(10);
  });
});

describe("camera clearance is engine-agnostic", () => {
  /**
   * Cesium can sample photogrammetry height and measure its own clearance.
   * Google's maps3d runtime cannot, which left the primary replay path with no
   * terrain-clearance guarantee. These assert the guarantee holds from recorded
   * elevation alone, so it applies to whichever renderer is mounted.
   */
  it("keeps the automatic camera above its floor for every mode and speed", () => {
    const manifest = createRouteSceneManifest(route);
    for (const cameraMode of ["auto", "runner", "chase", "overview"] as const) {
      for (const rangeScale of [0.6, 1, 1.8]) {
        for (const ratio of [0, 0.13, 0.5, 0.87, 1]) {
          const frame = resolveRouteSceneFrame(manifest, {
            cameraMode,
            following: true,
            progressM: manifest.totalDistanceM * ratio,
            rangeScale,
          });
          expect(
            frame.camera.clearanceM,
            `${cameraMode} at ${ratio} scale ${rangeScale}`,
          ).toBeGreaterThanOrEqual(frame.camera.minimumClearanceM);
        }
      }
    }
  });

  it("reports a finite clearance and floor", () => {
    const frame = resolveRouteSceneFrame(createRouteSceneManifest(route), {
      cameraMode: "auto",
      following: true,
      progressM: 100,
      rangeScale: 1,
    });
    expect(Number.isFinite(frame.camera.clearanceM)).toBe(true);
    expect(frame.camera.minimumClearanceM).toBeGreaterThan(0);
  });
});
