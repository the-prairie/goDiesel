import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import covers from "./manifest.json";
import routes from "../generated/routes.manifest.json";

describe("cached route covers", () => {
  it("covers each published route with a real, modest local image and finite recorded overlay", () => {
    expect(Object.keys(covers).sort()).toEqual(routes.routes.map(r => r.slug).sort());
    for (const [slug, cover] of Object.entries(covers)) {
      const path = resolve("public", cover.src.slice(1));
      expect(existsSync(path), slug).toBe(true);
      expect(statSync(path).size, slug).toBeLessThan(500_000);
      expect(readFileSync(path).toString("ascii", 8, 12), slug).toBe("WEBP");
      const points = cover.points.split(" ").map(p => p.split(",").map(Number));
      expect(points.length, slug).toBeGreaterThan(1);
      expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= cover.width && y <= cover.height), slug).toBe(true);
      const source = JSON.parse(readFileSync(resolve(`public/data/routes/${slug}.json`), "utf8"));
      expect(points.length, slug).toBe(source.route.length);
      expect(cover.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it("identifies generated artwork separately from geographic previews", () => {
    const generated = Object.entries(covers).filter(([, c]) => c.kind === "ai-enhanced");
    expect(generated.map(([id]) => id).sort()).toEqual(routes.routes.map(r => r.slug).sort());
    for (const [, c] of generated) expect(c.src).toMatch(/-ai\.webp$/);
  });
});
