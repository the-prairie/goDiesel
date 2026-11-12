import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { parseRouteSummary } from "@/domain/route";
import {
  WORLD_MAP,
  buildOverlandTowns,
  projectToWorldMap,
  spreadTowns,
} from "@/labs/overland/model/overland-towns";

function summary(overrides: Record<string, unknown>) {
  return parseRouteSummary({
    slug: "1",
    activity_id: "1",
    lifecycle: "completed",
    activity_name: "a run",
    region: "Calgary, AB",
    date: "2024-01-01",
    distance_km: 10,
    elevation_gain_m: 100,
    type: "Run",
    trace: [[51, -114, 1000, 0], [51.1, -114.1, 1010, 1000]],
    center_lat: 51.05,
    center_lng: -114.05,
    replay: { mode: "atlas", replay_eligible: true, best_in_earth: false, geometry_status: "ready" },
    ...overrides,
  });
}

describe("projectToWorldMap", () => {
  it("maps the world map's corners to its pixel corners", () => {
    expect(projectToWorldMap(WORLD_MAP.north, WORLD_MAP.west)).toEqual({ x: 0, y: 0 });
    expect(projectToWorldMap(WORLD_MAP.south, WORLD_MAP.east)).toEqual({
      x: WORLD_MAP.width,
      y: WORLD_MAP.height,
    });
  });

  it("puts Calgary where the pixel map draws southern Alberta", () => {
    const { x, y } = projectToWorldMap(51.05, -114.07);
    expect(x).toBeCloseTo(63.72, 2);
    expect(y).toBeCloseTo(35.8, 2);
  });
});

describe("buildOverlandTowns", () => {
  it("makes one town per place with its route count and distance", () => {
    const towns = buildOverlandTowns([
      summary({ slug: "a", distance_km: 10 }),
      summary({ slug: "b", distance_km: 5.5 }),
      summary({
        slug: "c",
        region: "Tokyo, Japan",
        trace: [[35.6, 139.7, 10, 0], [35.7, 139.8, 12, 1000]],
      }),
    ]);
    expect(towns.map((town) => [town.name, town.routeCount, town.km])).toEqual([
      ["Calgary, AB", 2, 15.5],
      ["Tokyo, Japan", 1, 10],
    ]);
    expect(towns[0].slugs).toEqual(["a", "b"]);
  });

  it("places a town at the centre of its routes' bounds, projected onto the map", () => {
    const [town] = buildOverlandTowns([
      summary({ trace: [[51, -114, 0, 0], [51.2, -114.4, 0, 1000]] }),
    ]);
    expect(town.lat).toBeCloseTo(51.1, 6);
    expect(town.lng).toBeCloseTo(-114.2, 6);
    expect(town).toMatchObject(projectToWorldMap(town.lat, town.lng));
  });

  it("falls back to the routes' recorded centres when no trace is usable", () => {
    const [town] = buildOverlandTowns([
      summary({
        trace: [],
        center_lat: 40,
        center_lng: -3,
        replay: { mode: "atlas", replay_eligible: false, best_in_earth: false, geometry_status: "missing" },
      }),
    ]);
    expect(town.lat).toBe(40);
    expect(town.lng).toBe(-3);
  });

  it("leaves out routes that are not completed", () => {
    const towns = buildOverlandTowns([
      summary({ slug: "a" }),
      summary({ slug: "b", region: "Rome, Italy", lifecycle: "discovered" }),
    ]);
    expect(towns.map((town) => town.name)).toEqual(["Calgary, AB"]);
  });

  it("orders towns west to east, for stepping through them", () => {
    const towns = buildOverlandTowns(routes);
    const longitudes = towns.map((town) => town.lng);
    expect(longitudes).toEqual([...longitudes].sort((a, b) => a - b));
  });

  it("covers every bundled place, all inside the map", () => {
    const completed = routes.filter((route) => route.lifecycle === "completed");
    const towns = buildOverlandTowns(routes);
    expect(towns).toHaveLength(new Set(completed.map((route) => route.region)).size);
    expect(towns.reduce((sum, town) => sum + town.routeCount, 0)).toBe(completed.length);
    for (const town of towns) {
      expect(town.x, town.name).toBeGreaterThanOrEqual(0);
      expect(town.x, town.name).toBeLessThanOrEqual(WORLD_MAP.width);
      expect(town.y, town.name).toBeGreaterThanOrEqual(0);
      expect(town.y, town.name).toBeLessThanOrEqual(WORLD_MAP.height);
    }
    const kyoto = towns.find((town) => town.name === "Kyoto, Japan")!;
    expect(kyoto.lat).toBeCloseTo(35.0, 0);
    expect(kyoto.lng).toBeCloseTo(135.8, 0);
  });
});

describe("spreadTowns", () => {
  it("moves towns apart until no two are closer than the minimum, keeping the rest in place", () => {
    const towns = buildOverlandTowns(routes);
    const spread = spreadTowns(towns, 11);
    expect(spread.map((town) => town.name)).toEqual(towns.map((town) => town.name));
    for (let i = 0; i < spread.length; i += 1) {
      for (let j = i + 1; j < spread.length; j += 1) {
        expect(Math.hypot(spread[i].x - spread[j].x, spread[i].y - spread[j].y), `${spread[i].name} / ${spread[j].name}`).toBeGreaterThanOrEqual(10.5);
      }
    }
    const london = (list: typeof towns) => list.find((town) => town.name === "London, UK")!;
    expect(spread.find((t) => t.name === "London, UK")).toMatchObject({ x: london(towns).x, y: london(towns).y });
    expect(towns).toEqual(buildOverlandTowns(routes));
  });
});
