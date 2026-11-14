import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { buildOverlandEntries } from "@/labs/overland/model/overland-entries";
import { buildOverlandTowns } from "@/labs/overland/model/overland-towns";
import { startBearing, townBySlug, townInput, townSlug } from "@/labs/overland/model/town-input";

const ENTRIES = buildOverlandEntries(routes);
const TOWNS = buildOverlandTowns(routes);

describe("townSlug", () => {
  it("is a readable path segment, unique for every place", () => {
    expect(townSlug("Kyoto, Japan")).toBe("kyoto-japan");
    expect(townSlug("Banff/Kananaskis")).toBe("banff-kananaskis");
    const slugs = TOWNS.map((town) => townSlug(town.name));
    expect(new Set(slugs).size).toBe(TOWNS.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("finds the town again from its slug", () => {
    expect(townBySlug(TOWNS, "kyoto-japan")?.name).toBe("Kyoto, Japan");
    expect(townBySlug(TOWNS, "nowhere")).toBeUndefined();
  });
});

describe("startBearing", () => {
  it("reads the compass bearing the route leaves on", () => {
    expect(startBearing([{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, { lat: 0.02, lng: 0 }])).toBeCloseTo(0, 0);
    expect(startBearing([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0, lng: 0.02 }])).toBeCloseTo(90, 0);
    expect(startBearing([{ lat: 0, lng: 0 }, { lat: 0, lng: -0.01 }])).toBeCloseTo(270, 0);
    expect(startBearing([{ lat: 0, lng: 0 }])).toBe(0);
  });
});

describe("townInput", () => {
  it("gives Kyoto its two routes, numbered as the index numbers them, titles exact", () => {
    const kyoto = TOWNS.find((town) => town.name === "Kyoto, Japan")!;
    const input = townInput(kyoto, routes, ENTRIES);
    expect(input.biome).toBe("japan");
    expect(input.coastal).toBe(false);
    expect(input.routes.map((route) => route.title).sort()).toEqual(["i love goooooooolddddddddd", "🍑🍑🍑🍑💦💦💦💦"].sort());
    for (const route of input.routes) {
      expect(route.number).toBe(ENTRIES.find((entry) => entry.slug === route.slug)!.number);
      expect(route.startBearingDeg).toBeGreaterThanOrEqual(0);
      expect(route.startBearingDeg).toBeLessThan(360);
    }
    expect(input.residents).toEqual([]);
  });
});
