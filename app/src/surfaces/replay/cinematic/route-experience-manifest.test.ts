import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { routeExperienceManifest } from "@/surfaces/replay/cinematic/route-experience-manifest";

const route = {
  slug: "route-test",
  route: [
    { lat: 51, lng: -114, elev: 1000, d: 0 },
    { lat: 51.01, lng: -114.005, elev: 1100, d: 1000 },
    { lat: 51.018, lng: -114.02, elev: 1450, d: 2200 },
    { lat: 51.02, lng: -114.04, elev: 1180, d: 3600 },
    { lat: 51.01, lng: -114.05, elev: 1050, d: 5000 },
  ],
  centerLat: 51.01,
  centerLng: -114.025,
  distanceKm: 5,
} as QuestRoute;

describe("Route Experience Manifest", () => {
  it("is deterministic and carries both trailer and feature compatibility", () => {
    const first = routeExperienceManifest(route);
    const second = routeExperienceManifest(route);

    expect(second).toEqual(first);
    expect(first.routeFingerprint).toHaveLength(16);
    expect(first.renderFingerprint).toHaveLength(16);
    expect(first.selectedMeaningfulMoments.length).toBeGreaterThan(0);
    expect(first.teaserTimeline).toHaveLength(4);
    expect(first.featureTimeline.length).toBeGreaterThan(3);
    expect(first.recommendationReasons.length).toBeGreaterThan(1);
  });

  it("changes the render fingerprint when route geometry changes", () => {
    const changed = {
      ...route,
      route: route.route.map((point, index) => index === 2 ? { ...point, elev: point.elev + 200 } : point),
    };
    expect(routeExperienceManifest(changed).renderFingerprint).not.toBe(
      routeExperienceManifest(route).renderFingerprint,
    );
  });

  it("does not invent elevation moments when source elevation is unavailable", () => {
    const unavailable = {
      ...route,
      provenance: {
        temporal: { status: "unavailable" },
        elevation: { status: "unavailable" },
        track: { segmentCount: 1 },
        discontinuities: [],
      },
    } as QuestRoute;
    const manifest = routeExperienceManifest(unavailable);

    expect(manifest.recommendationReasons).toContain("elevation unavailable in the source");
    expect(manifest.routeProfile).toMatchObject({ character: "unknown", reliefM: null });
    expect(manifest.recommendedCinematicCut).not.toBe("intimate");
    expect(manifest.selectedMeaningfulMoments).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "climb" }),
      expect.objectContaining({ kind: "summit" }),
      expect.objectContaining({ kind: "terrain" }),
    ]));
    expect(manifest.renderFingerprint).not.toBe(routeExperienceManifest(route).renderFingerprint);
  });
});
