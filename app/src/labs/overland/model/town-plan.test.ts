import { describe, expect, it } from "vitest";

import { BIOMES, type Biome } from "@/labs/overland/model/place-biomes";
import {
  RESIDENT_SPOTS,
  pathDistance,
  planTown,
  townSeason,
  type TownInput,
  type TownPlan,
  type TownRoute,
} from "@/labs/overland/model/town-plan";

function route(number: number, overrides: Partial<TownRoute> = {}): TownRoute {
  return {
    slug: `r${number}`,
    number,
    title: `route ${number}`,
    km: 10 + number,
    date: "2025-11-23",
    kind: "run",
    startBearingDeg: 90,
    ...overrides,
  };
}

const KYOTO: TownInput = {
  place: "Kyoto, Japan",
  lat: 35.01,
  lng: 135.77,
  biome: "japan",
  coastal: false,
  routes: [
    route(64, { title: "i love goooooooolddddddddd", km: 32.6, date: "2025-11-23", startBearingDeg: 250 }),
    route(65, { title: "🍑🍑🍑🍑💦💦💦💦", km: 21.3, date: "2025-11-24", startBearingDeg: 70 }),
  ],
};

function town(biome: Biome, overrides: Partial<TownInput> = {}): TownInput {
  return { place: `A ${biome} place`, lat: 45, lng: 10, biome, coastal: false, routes: [route(1), route(2)], ...overrides };
}

function inHouse(plan: TownPlan, x: number, z: number, pad = 0) {
  return plan.houses.some((house) => Math.abs(x - house.x) < house.width / 2 + pad && Math.abs(z - house.z) < house.depth / 2 + pad);
}

describe("planTown", () => {
  it("gives the same town for the same place, as plain data", () => {
    const a = planTown(KYOTO);
    const b = planTown(structuredClone(KYOTO));
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("seeds each place differently", () => {
    expect(planTown(town("japan", { place: "Kyoto, Japan" })).seed).not.toBe(planTown(town("japan", { place: "Okayama, Japan" })).seed);
  });

  it("puts up one signpost per route, numbered as the app numbers routes, with her title exactly", () => {
    const plan = planTown(KYOTO);
    expect(plan.signposts.map((sign) => sign.label)).toEqual(["064", "065"]);
    expect(plan.signposts.map((sign) => sign.slug)).toEqual(["r64", "r65"]);
    expect(plan.signposts[1].title).toBe("🍑🍑🍑🍑💦💦💦💦");
  });

  it("points a route that leaves westward to the left of town, and eastward to the right", () => {
    const [west, east] = planTown(KYOTO).signposts;
    expect(west.x).toBeLessThan(east.x);
    expect(west.side).toBe(-1);
    expect(east.side).toBe(1);
  });

  it("keeps every signpost readable: on the town's front edge, clear of houses, posts apart", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 8, 12]) {
      const routes = Array.from({ length: count }, (_, index) => route(index + 1, { startBearingDeg: (index * 47) % 360 }));
      const plan = planTown(town("med", { routes }));
      expect(plan.signposts).toHaveLength(count);
      expect(new Set(plan.signposts.map((sign) => sign.slug)).size).toBe(count);
      const posts = new Map<number, { x: number; z: number }>();
      for (const sign of plan.signposts) {
        expect(inHouse(plan, sign.x, sign.z, 0.6)).toBe(false);
        expect(Math.abs(sign.x)).toBeLessThanOrEqual(6.6);
        posts.set(sign.post, { x: sign.x, z: sign.z });
      }
      const xs = [...posts.values()].map((post) => post.x).sort((a, b) => a - b);
      for (let index = 1; index < xs.length; index += 1) expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(2.1);
      // A post holds at most two boards.
      for (const post of posts.keys()) expect(plan.signposts.filter((sign) => sign.post === post).length).toBeLessThanOrEqual(count > 8 ? 3 : 2);
    }
  });

  it("builds Kyoto from cedar and maple and ginkgo, machiya and kura, beside a canal, in autumn", () => {
    const plan = planTown(KYOTO);
    expect(plan.season).toBe("autumn");
    expect(plan.canopy).toBe("cedar");
    const species = new Set(plan.trees.map((tree) => tree.species));
    expect(species).toContain("maple-red");
    expect(species).toContain("ginkgo");
    expect(plan.houses.map((house) => house.kind)).toEqual(expect.arrayContaining(["machiya", "kura"]));
    expect(plan.water.kind).toBe("canal");
  });

  it("dresses every biome differently, not Kyoto recoloured", () => {
    const signatures = BIOMES.map((biome) => {
      const plan = planTown(town(biome, { lat: biome === "jungle" ? -8 : 40 }));
      return { biome, canopy: plan.canopy, houses: [...new Set(plan.houses.map((house) => house.kind))].sort().join(","), grass: plan.ground.grass.join(","), filler: plan.filler };
    });
    for (let i = 0; i < signatures.length; i += 1) {
      for (let j = i + 1; j < signatures.length; j += 1) {
        const a = signatures[i];
        const b = signatures[j];
        expect(a.houses === b.houses && a.canopy === b.canopy, `${a.biome} and ${b.biome} share a kit`).toBe(false);
        expect(a.grass, `${a.biome} and ${b.biome} share ground`).not.toBe(b.grass);
      }
    }
    const japan = signatures.find((entry) => entry.biome === "japan")!;
    for (const other of signatures.filter((entry) => entry.biome !== "japan")) {
      expect(other.houses.split(",").some((kind) => japan.houses.split(",").includes(kind)) && other.canopy === "cedar").toBe(false);
    }
  });

  it("fills a city with blocks, a prairie with fields, and a forest town with forest", () => {
    expect(planTown(town("city")).filler).toBe("blocks");
    expect(planTown(town("prairie")).filler).toBe("fields");
    expect(planTown(town("japan")).filler).toBe("forest");
    const forest = planTown(town("japan")).trees.length;
    expect(planTown(town("med")).trees.length).toBeLessThan(forest / 2);
  });

  it("sets a coastal town on a shore, an alpine town under peaks", () => {
    expect(planTown(town("pnw", { coastal: true })).water.kind).toBe("shore");
    expect(planTown(town("japan", { coastal: true })).water.kind).toBe("shore");
    expect(planTown(town("alpine")).backdrop).toBe("peaks");
    expect(planTown(town("volc")).backdrop).toBe("volcano");
    expect(planTown(town("prairie")).water.kind).not.toBe("shore");
  });

  it("never stands a tree on a path, in a house or in the water", () => {
    for (const biome of BIOMES) {
      const plan = planTown(town(biome, { coastal: biome === "pnw" }));
      for (const tree of plan.trees) {
        expect(pathDistance(plan, tree.x, tree.z), `${biome} tree on a path`).toBeGreaterThan(0.3);
        expect(inHouse(plan, tree.x, tree.z), `${biome} tree in a house`).toBe(false);
        if (plan.water.kind === "canal") expect(tree.z > plan.water.z0 - 0.4 && tree.z < plan.water.z1 + 0.4).toBe(false);
        if (plan.water.kind === "shore") expect(tree.z).toBeLessThan(plan.water.z0);
      }
    }
  });

  it("ranks trees so a lower quality can drop the far ones first", () => {
    const plan = planTown(KYOTO);
    const ranks = plan.trees.map((tree) => tree.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    const feature = plan.trees.filter((tree) => tree.feature);
    expect(feature.length).toBeGreaterThan(5);
    // Every feature tree outranks every filler tree.
    expect(Math.max(...feature.map((tree) => tree.rank))).toBeLessThan(Math.min(...plan.trees.filter((tree) => !tree.feature).map((tree) => tree.rank)));
  });

  it("spawns the runner on the town's loop path", () => {
    const plan = planTown(KYOTO);
    expect(pathDistance(plan, plan.spawn.x, plan.spawn.z)).toBeLessThan(0);
    expect(plan.runnerLoop.length).toBeGreaterThan(8);
  });

  it("has more houses for a place with more routes", () => {
    expect(planTown(town("farm", { routes: [route(1)] })).houses.length).toBeLessThan(planTown(town("farm", { routes: Array.from({ length: 6 }, (_, i) => route(i + 1)) })).houses.length);
  });
});

describe("residents", () => {
  it("is an extension point: a spot for each resident, and nothing else changes", () => {
    const residents = [
      { id: "a", nickname: "Pip", spot: "pond" as const },
      { id: "b", nickname: "Moss", spot: "pond" as const },
      { id: "c", nickname: "Ash", spot: "unknown" as never },
    ];
    const plan = planTown({ ...KYOTO, residents });
    expect(plan.residents.map((resident) => resident.id)).toEqual(["a", "b", "c"]);
    const [a, b, c] = plan.residents;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.8);
    expect(c.spot).toBe("path");
    expect({ ...plan, residents: [] }).toEqual(planTown(KYOTO));
    expect(RESIDENT_SPOTS).toContain("signposts");
  });
});

describe("townSeason", () => {
  it("reads the season from her dates and the hemisphere", () => {
    expect(townSeason(["2025-11-23", "2025-11-24"], 35)).toBe("autumn");
    expect(townSeason(["2025-01-02"], 35)).toBe("winter");
    expect(townSeason(["2025-01-02"], -33)).toBe("summer");
    expect(townSeason(["2025-04-19"], 51)).toBe("spring");
    expect(townSeason(["2023-10-21"], -8)).toBe("tropical");
  });

  it("uses the middle of her dates", () => {
    expect(townSeason(["2024-09-28", "2025-05-24", "2025-05-25", "2021-07-10"], 51)).toBe("spring");
  });

  it("snows on a winter prairie but not on a winter Greek island", () => {
    expect(planTown(town("prairie", { routes: [route(1, { date: "2025-01-10" })], lat: 52 })).snow).toBe(true);
    expect(planTown(town("med", { routes: [route(1, { date: "2025-01-02" })], lat: 35 })).snow).toBe(false);
  });
});
