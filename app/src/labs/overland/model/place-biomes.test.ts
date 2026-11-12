import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { BIOMES, placeLook } from "@/labs/overland/model/place-biomes";

describe("placeLook", () => {
  it("gives each of her places the look chosen for it", () => {
    expect(placeLook("Kyoto, Japan", 35)).toMatchObject({ biome: "japan", coastal: false });
    expect(placeLook("Crete, Greece", 35)).toMatchObject({ biome: "med", coastal: true });
    expect(placeLook("Banff/Kananaskis", 51)).toMatchObject({ biome: "alpine", coastal: false });
  });

  it("chooses an explicit look for every bundled place", () => {
    for (const region of new Set(routes.map((route) => route.region))) {
      expect(placeLook(region, 0).explicit, region).toBe(true);
    }
  });

  it("falls back by latitude for a place it has never seen, so a new place never breaks", () => {
    expect(placeLook("Somewhere new", 5)).toEqual({ biome: "jungle", coastal: false, explicit: false });
    expect(placeLook("Somewhere new", -30)).toEqual({ biome: "med", coastal: false, explicit: false });
    expect(placeLook("Somewhere new", 52)).toEqual({ biome: "farm", coastal: false, explicit: false });
    for (const latitude of [-80, -20, 0, 20, 45, 80]) {
      expect(BIOMES).toContain(placeLook("Somewhere new", latitude).biome);
    }
  });
});
