import { beforeEach, describe, expect, it, vi } from "vitest";

import { curatedRouteDiscoveryProvider } from "@/data/discovery-provider";
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
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const result = savePlannedRoute(candidate, finderIntent, new Date("2026-07-14T12:00:00Z"));

    expect(result.created).toBe(true);
    expect(result.route).toMatchObject({
      slug: "planned-owner-route-17654151284",
      lifecycle: "planned",
      date: "2026-07-14",
      replay: {
        replayEligible: false,
        bestInEarth: false,
      },
      planning: {
        candidateId: "owner-route-17654151284",
        sourceRouteSlug: "17654151284",
        storeVersion: 1,
      },
    });

    const encoded = encodePlannedRouteStore([result.route]);
    expect(JSON.parse(encoded)).toMatchObject({ version: 1, routes: [{ lifecycle: "planned" }] });
    expect(decodePlannedRouteStore(encoded)).toEqual([result.route]);
  });

  it("does not duplicate the same candidate", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];

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
