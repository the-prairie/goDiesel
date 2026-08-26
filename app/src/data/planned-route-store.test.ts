import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCuratedRouteDiscoveryProvider } from "@/data/discovery-provider";
import type { RouteSummary } from "@/domain/route";
import {
  decodePlannedRouteStore,
  encodePlannedRouteStore,
  savePlannedRoute,
} from "@/data/planned-route-store";
import type { FinderIntent } from "@/domain/planning";

const finderIntent: FinderIntent = {
  place: "Kyoto",
  activity: "Run",
  distanceKm: 21,
  terrain: "mixed",
  vibe: "exploratory climbing",
};
const discoveryProvider = createCuratedRouteDiscoveryProvider([{
  slug: "route-discovered",
  lifecycle: "discovered",
  region: "Kyoto",
  type: "Run",
  distanceKm: 21,
  theme: "exploratory climbing",
  trace: [{ lat: 35, lng: 135, elev: 10, d: 0 }, { lat: 35.1, lng: 135.1, elev: 20, d: 21_000 }],
  guide: { reviewStatus: "draft" },
  discovery: { terrain: ["mixed"], vibes: ["exploratory climbing"] },
} as RouteSummary]);

describe("planned route store", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("persists a versioned planned route without making it replay eligible", () => {
    const candidate = discoveryProvider.search(finderIntent).candidates[0];
    const result = savePlannedRoute(candidate, finderIntent, new Date("2026-07-14T12:00:00Z"));

    expect(result.created).toBe(true);
    expect(result.route).toMatchObject({
      slug: "planned-owner-route-route-discovered",
      lifecycle: "planned",
      date: "2026-07-14",
      replay: {
        replayEligible: false,
        bestInEarth: false,
      },
      planning: {
        candidateId: "owner-route-route-discovered",
        sourceRouteSlug: "route-discovered",
        storeVersion: 1,
      },
    });

    const encoded = encodePlannedRouteStore([result.route]);
    expect(JSON.parse(encoded)).toMatchObject({ version: 1, routes: [{ lifecycle: "planned" }] });
    expect(decodePlannedRouteStore(encoded)).toEqual([result.route]);
  });

  it("does not duplicate the same candidate", () => {
    const candidate = discoveryProvider.search(finderIntent).candidates[0];

    expect(savePlannedRoute(candidate, finderIntent).created).toBe(true);
    expect(savePlannedRoute(candidate, finderIntent).created).toBe(false);
  });

  it("rejects malformed or unknown store versions", () => {
    expect(decodePlannedRouteStore("not json")).toEqual([]);
    expect(decodePlannedRouteStore(JSON.stringify({ version: 2, routes: [] }))).toEqual([]);
    expect(
      decodePlannedRouteStore(
        JSON.stringify({ version: 1, routes: [{ lifecycle: "completed" }] }),
      ),
    ).toEqual([]);
  });
});
