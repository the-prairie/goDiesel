import { describe, expect, it } from "vitest";

import { applyRouteGenomeEnrichment, buildRouteGenome } from "@/domain/route-genome";
import { parseRouteDetail } from "@/domain/routes";

const fixture = parseRouteDetail({
  slug: "test-route",
  activity_id: "test-route",
  lifecycle: "completed",
  name: "Test route",
  subtitle: "A test",
  activity_name: "Test route",
  region: "Test place",
  date: "2026-01-01",
  distance_km: 2,
  elevation_gain_m: 100,
  type: "Run",
  description: "Test description",
  completion_rule: "Complete it",
  difficulty: "Moderate",
  theme: "test",
  xp: 100,
  center_lat: 50,
  center_lng: -120,
  mid_idx: 1,
  replay: {
    mode: "atlas",
    replay_eligible: true,
    best_in_earth: false,
    geometry_status: "ready",
  },
  route: [
    { lat: 50, lng: -120, elev: 10, d: 0 },
    { lat: 50.01, lng: -120.01, elev: 110, d: 1000 },
    { lat: 50, lng: -120, elev: 10, d: 2000 },
  ],
});

describe("buildRouteGenome", () => {
  it("creates a stable comparative profile from recorded geometry", () => {
    const genome = buildRouteGenome(fixture);

    expect(genome.bins).toHaveLength(64);
    expect(genome.chapters).toHaveLength(4);
    expect(genome.metrics.find((metric) => metric.label === "Climb density")?.display).toBe(
      "50 m / km",
    );
    expect(genome.metrics.find((metric) => metric.label === "Climb density")?.confidence).toBe(
      "derived",
    );
    expect(genome.metrics.find((metric) => metric.label === "Vertical range")?.confidence).toBe(
      "derived",
    );
    expect(genome.metrics.find((metric) => metric.label === "Loop closure")?.display).toBe(
      "Closed loop",
    );
    expect(genome.routePath.startsWith("M")).toBe(true);
  });

  it("replaces hypotheses with source-backed Earth Engine signals", () => {
    const genome = buildRouteGenome(fixture);
    const enriched = applyRouteGenomeEnrichment(genome, {
      route_id: "test-route",
      generated_at: "2026-07-21T00:00:00Z",
      corridor_m: 300,
      signals: { built: 72 },
      samples: [],
      datasets: [{ id: "GOOGLE/DYNAMICWORLD/V1", role: "land cover" }],
    });

    expect(enriched.environmental.find((signal) => signal.key === "built")).toMatchObject({
      value: 72,
      status: "earth-engine-ready",
    });
  });
});
