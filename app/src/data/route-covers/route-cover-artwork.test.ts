import { describe, expect, it } from "vitest";
import routes from "../generated/routes.manifest.json";
import { loadRouteCoverArtwork } from "./route-cover-artwork";

describe("route cover artwork", () => {
  it("loads the cover manifest once, on demand, for every route", async () => {
    const first = loadRouteCoverArtwork();
    expect(loadRouteCoverArtwork()).toBe(first);
    const loaded = await first;
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(Object.keys(loaded.covers).sort()).toEqual(routes.routes.map((route) => route.slug).sort());
  });
});
