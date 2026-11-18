import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { exploredRoutes } from "@/labs/sketch/sketch-reveal";
import { SKETCH_ATTRIBUTION, sketchStyle } from "@/labs/sketch/sketch-style";

const explored = exploredRoutes(routes).filter((route) => ["17636880071", "17654151284"].includes(route.slug));
const style = (look: "line" | "pencil", reveal: "line" | "corridor" | "wash") => sketchStyle({ look, reveal, explored });
const layer = (s: ReturnType<typeof sketchStyle>, id: string) => s.layers.find((candidate) => candidate.id === id);
const json = (value: unknown) => JSON.stringify(value);

/** Every literal colour written in a layer's paint. */
function colours(value: unknown): string[] {
  const text = json(value);
  return [...text.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((match) => match[1].toLowerCase());
}
const isGrey = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) <= 24;
};

describe("sketchStyle", () => {
  it("draws from OpenFreeMap's OpenStreetMap tiles and Natural Earth relief, credited", () => {
    const s = style("line", "corridor");
    expect(json(s.sources)).toContain("https://tiles.openfreemap.org/planet");
    expect(json(s.sources)).toContain("ne2sr");
    expect(SKETCH_ATTRIBUTION).toContain("OpenStreetMap contributors");
    expect(json(s.sources)).toContain("OpenStreetMap contributors");
    expect(json(s.sources)).toContain("Natural Earth");
  });

  it("keeps the world monochrome: only the reveal and her line carry colour", () => {
    for (const look of ["line", "pencil"] as const)
      for (const reveal of ["line", "corridor", "wash"] as const) {
        const s = style(look, reveal);
        for (const candidate of s.layers) {
          if (candidate.id.startsWith("explored-") || candidate.id.startsWith("route-")) continue;
          // A paint that depends on lying near her routes is a reveal.
          const paint = (candidate as { paint?: Record<string, unknown> }).paint ?? {};
          for (const [property, value] of Object.entries(paint)) {
            const greys = json(value).includes('"feature-state"') ? [] : colours(value);
            for (const colour of greys) expect(isGrey(colour), `${look}/${reveal} ${candidate.id}.${property} ${colour}`).toBe(true);
          }
        }
      }
  });

  it("inks her routes on top of the world", () => {
    const s = style("line", "line");
    const ids = s.layers.map((candidate) => candidate.id);
    expect(ids).toContain("route-line");
    expect(ids.indexOf("route-line")).toBeGreaterThan(ids.indexOf("building-3d"));
    expect(json(s.sources["sketch-routes"])).toContain("17636880071");
  });

  it("hands her route to the ground drawing close up: the flat line fades out as buildings stand up", () => {
    for (const id of ["route-line", "route-casing"]) {
      const opacity = json((layer(style("line", "corridor"), id) as { paint: Record<string, unknown> }).paint["line-opacity"]);
      expect(opacity, id).toContain("zoom");
      expect(opacity, id).toMatch(/15\.5,0/);
    }
  });

  it("draws a bridge's railings either side of its deck, from the data's bridges", () => {
    const s = style("line", "line");
    for (const id of ["bridge-railing-left", "bridge-railing-right"]) {
      const railing = layer(s, id) as { filter: unknown; paint: Record<string, unknown> };
      expect(json(railing.filter), id).toContain('"bridge"');
      expect(railing.paint["line-offset"], id).toBeDefined();
    }
  });

  it("reveals nothing but the line itself in line mode", () => {
    expect(json(style("line", "line").layers)).not.toContain('"feature-state"');
    expect(layer(style("line", "line"), "explored-wash")).toBeUndefined();
  });

  it("colours what lies within the corridor round her routes, ground included", () => {
    const s = style("line", "corridor");
    // Water and parks by feature; buildings building by building in the edge layer.
    expect(json(layer(s, "water"))).toContain('"feature-state"');
    expect(json(layer(s, "park"))).toContain('"feature-state"');
    expect(json(layer(s, "building-3d"))).not.toContain('"feature-state"');
    expect(layer(s, "explored-ground")?.type).toBe("fill");
    expect(layer(s, "explored-wash")).toBeUndefined();
  });

  it("lays a soft watercolour wash under the line work in wash mode", () => {
    const s = style("line", "wash");
    const wash = layer(s, "explored-wash");
    expect(wash?.type).toBe("heatmap");
    const ids = s.layers.map((candidate) => candidate.id);
    expect(ids.indexOf("explored-wash")).toBeLessThan(ids.indexOf("road-minor"));
  });

  it("draws the pencil look in graphite, the clean look in ink", () => {
    const ink = colours(layer(style("line", "line"), "road-minor-casing"));
    const graphite = colours(layer(style("pencil", "line"), "road-minor-casing"));
    expect(ink).not.toEqual(graphite);
  });

  it("is the same for the same options", () => {
    expect(json(style("pencil", "wash"))).toBe(json(style("pencil", "wash")));
  });
});
