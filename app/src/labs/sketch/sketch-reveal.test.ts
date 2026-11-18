import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { REVEAL_RADIUS_M, corridorPolygons, exploredRoutes, lineBoxes, linesNearTile, metresBetween, samplePoints, withTracks, type LngLat } from "@/labs/sketch/sketch-reveal";

const KYOTO = ["17636880071", "17654151284"];

describe("exploredRoutes", () => {
  it("counts her completed routes as explored, each with its line in lng/lat order", () => {
    const explored = exploredRoutes(routes);
    for (const slug of KYOTO) {
      const route = explored.find((candidate) => candidate.slug === slug)!;
      expect(route.by).toBe("owner");
      const source = routes.find((candidate) => candidate.slug === slug)!;
      expect(route.line[0]).toEqual([source.trace[0].lng, source.trace[0].lat]);
    }
  });

  it("leaves out a route without a line, and routes not completed", () => {
    const base = routes.find((route) => route.slug === KYOTO[0])!;
    const explored = exploredRoutes([
      { ...base, slug: "empty", trace: [] },
      { ...base, slug: "planned", lifecycle: "discovered" } as typeof base,
      base,
    ]);
    expect(explored.map((route) => route.slug)).toEqual([KYOTO[0]]);
  });

  it("takes other people's verified completions too, kept apart by who explored", () => {
    const base = routes.find((route) => route.slug === KYOTO[0])!;
    const explored = exploredRoutes([base], [{ slug: "friend-1", line: [[135.7, 35], [135.71, 35.01]], by: "verified" }]);
    expect(explored.map((route) => [route.slug, route.by])).toEqual([
      [KYOTO[0], "owner"],
      ["friend-1", "verified"],
    ]);
  });
});

describe("samplePoints", () => {
  it("keeps both ends and puts no two neighbours further apart than the spacing", () => {
    const line: [number, number][] = [[135.75, 35.0], [135.76, 35.0], [135.76, 35.01]];
    const points = samplePoints(line, 50);
    expect(points[0]).toEqual(line[0]);
    expect(points.at(-1)).toEqual(line.at(-1));
    for (let i = 1; i < points.length; i += 1) expect(metresBetween(points[i - 1], points[i])).toBeLessThanOrEqual(50.5);
    // About 910 m east and 1110 m north: some 41 points at 50 m.
    expect(points.length).toBeGreaterThan(38);
    expect(points.length).toBeLessThan(46);
  });

  it("returns a lone point for a line that does not move", () => {
    expect(samplePoints([[1, 2], [1, 2]], 50)).toEqual([[1, 2]]);
  });
});

describe("the reveal radii", () => {
  it("widens from the line, to a corridor, to a wash", () => {
    expect(REVEAL_RADIUS_M.line).toBe(0);
    expect(REVEAL_RADIUS_M.corridor).toBeGreaterThan(50);
    expect(REVEAL_RADIUS_M.wash).toBeGreaterThan(REVEAL_RADIUS_M.corridor * 2);
  });
});

describe("corridorPolygons", () => {
  const line: [number, number][] = [[135.75, 35.0], [135.76, 35.0], [135.76, 35.01]];
  const inside = (point: [number, number], polygons: ReturnType<typeof corridorPolygons>) =>
    polygons.coordinates.some(([ring]) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    });
  // Metres to degrees at 35° north.
  const north = (m: number) => m / 110_574;
  const east = (m: number) => m / (111_320 * Math.cos((35 * Math.PI) / 180));

  it("covers everything within the radius of the route, and nothing well beyond it", () => {
    const polygons = corridorPolygons([line], 120);
    expect(inside([135.755, 35.0 + north(100)], polygons)).toBe(true);
    expect(inside([135.755, 35.0 - north(100)], polygons)).toBe(true);
    // Round the corner and past the end.
    expect(inside([135.76 + east(80), 35.0 - north(80)], polygons)).toBe(true);
    expect(inside([135.755, 35.0 + north(140)], polygons)).toBe(false);
    expect(inside([135.76 + east(150), 35.005], polygons)).toBe(false);
  });

  it("makes nothing for the line reveal", () => {
    expect(corridorPolygons([line], 0).coordinates).toEqual([]);
  });
});

describe("the routes a tile needs", () => {
  // Kyoto's z14 tile 14370/6490 and a line through it; Victoria and Rome far away.
  const kyoto: LngLat[] = [[135.75, 34.98], [135.76, 34.99]];
  const victoria: LngLat[] = [[-123.36, 48.42], [-123.35, 48.43]];
  const rome: LngLat[] = [[12.49, 41.88], [12.5, 41.89]];
  const lines = [kyoto, victoria, rome];

  it("sends a tile only the lines that pass within the reveal's reach of it", () => {
    const near = linesNearTile(lines, lineBoxes(lines), { z: 14, x: 14370, y: 6490 }, 200);
    expect(near).toEqual([kyoto]);
  });

  it("keeps a line that only comes within reach of the tile's edge", () => {
    // A line just west of the tile, 150 m off its edge.
    const n = 2 ** 14;
    const westEdge = (14370 / n) * 360 - 180;
    const offset = 150 / (111320 * Math.cos((35.0 * Math.PI) / 180));
    const beside: LngLat[] = [[westEdge - offset, 34.98], [westEdge - offset, 34.985]];
    expect(linesNearTile([beside], lineBoxes([beside]), { z: 14, x: 14370, y: 6490 }, 200)).toEqual([beside]);
    expect(linesNearTile([beside], lineBoxes([beside]), { z: 14, x: 14370, y: 6490 }, 100)).toEqual([]);
  });
});

describe("her routes drawn from their full tracks once loaded", () => {
  const summary = [
    { slug: "a", line: [[0, 0], [1, 1]] as LngLat[], by: "owner" as const },
    { slug: "b", line: [[2, 2], [3, 3]] as LngLat[], by: "owner" as const },
  ];

  it("swaps in a loaded track and keeps the summary as the stand-in for the rest", () => {
    const track: LngLat[] = [[0, 0], [0.4, 0.6], [0.7, 0.8], [1, 1]];
    const lines = withTracks(summary, new Map([["a", track]]));
    expect(lines.map((route) => route.line)).toEqual([track, summary[1].line]);
    expect(lines[0]).toMatchObject({ slug: "a", by: "owner" });
  });

  it("keeps the same list when nothing has loaded, and ignores a track too short to draw", () => {
    expect(withTracks(summary, new Map())).toBe(summary);
    expect(withTracks(summary, new Map([["a", [[0, 0]] as LngLat[]]]))[0].line).toBe(summary[0].line);
  });
});
