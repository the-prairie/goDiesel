import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  curatedDiscoveryCandidates,
  curatedRouteDiscoveryProvider,
} from "@/data/discovery-provider";
import {
  decodePlannedRouteStore,
  encodePlannedRouteStore,
  getPlannedRoutes,
  removePlannedRoute,
  savePlannedRoute,
  updatePlannedRouteIntent,
} from "@/data/planned-route-store";
import type { FinderIntent } from "@/domain/planning";
import { findRecordedPlanMatches } from "@/domain/plan-completion";

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
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
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

  it("edits planning intent without promoting the plan or changing its source", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const saved = savePlannedRoute(
      candidate,
      finderIntent,
      new Date("2026-07-14T12:00:00Z"),
    ).route;

    const updated = updatePlannedRouteIntent(saved.slug, {
      ...finderIntent,
      distanceKm: 24,
      vibe: "quiet temple roads",
    });

    expect(updated).toMatchObject({
      slug: saved.slug,
      lifecycle: "planned",
      planning: {
        sourceRouteSlug: saved.planning.sourceRouteSlug,
        createdAt: "2026-07-14T12:00:00.000Z",
        intent: { distanceKm: 24, vibe: "quiet temple roads" },
      },
      replay: { replayEligible: false },
    });
  });

  it("rebinds place and activity edits to a coherent planning source", () => {
    const kyoto = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const saved = savePlannedRoute(kyoto, finderIntent).route;
    const victoriaIntent: FinderIntent = {
      place: "Victoria, BC",
      activity: "Ride",
      distanceKm: 90,
      terrain: "road",
      vibe: "quiet farm roads",
    };
    const victoria = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "5650407638",
    )!;

    expect(updatePlannedRouteIntent(saved.slug, victoriaIntent)).toBeUndefined();
    expect(updatePlannedRouteIntent(saved.slug, victoriaIntent, kyoto)).toBeUndefined();
    const updated = updatePlannedRouteIntent(
      saved.slug,
      victoriaIntent,
      victoria,
      new Date("2026-08-16T12:00:00Z"),
    );

    expect(updated).toMatchObject({
      slug: `planned-${victoria.id}`,
      lifecycle: "planned",
      date: "2026-08-16",
      region: "Victoria, BC",
      type: "Ride",
      distanceKm: 84.6,
      planning: {
        candidateId: victoria.id,
        sourceRouteSlug: victoria.sourceRouteSlug,
        createdAt: "2026-08-16T12:00:00.000Z",
        sourceSnapshot: victoria.route,
        intent: victoriaIntent,
      },
      replay: { replayEligible: false },
    });
    expect(updated?.trace).toEqual(victoria.route.trace);
    expect(findRecordedPlanMatches(updated!, [{
      ...victoria.route,
      slug: "victoria-before-rebind",
      date: "2026-07-01",
    }])).toEqual([]);
  });

  it("keeps canonical slugs and source ownership unique across rebinds", () => {
    const kyoto = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "17654151284",
    )!;
    const victoria = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "5650407638",
    )!;
    const victoriaIntent: FinderIntent = {
      place: "Victoria, BC",
      activity: "Ride",
      distanceKm: 84.6,
      terrain: "road",
      vibe: "farm roads",
    };
    const kyotoPlan = savePlannedRoute(kyoto, finderIntent).route;
    const rebound = updatePlannedRouteIntent(
      kyotoPlan.slug,
      victoriaIntent,
      victoria,
      new Date("2026-08-16T12:00:00Z"),
    )!;
    const newKyotoPlan = savePlannedRoute(kyoto, finderIntent);

    expect(newKyotoPlan.created).toBe(true);
    expect(new Set(getPlannedRoutes().map((route) => route.slug)).size).toBe(2);
    expect(getPlannedRoutes().map((route) => route.slug)).toEqual([
      rebound.slug,
      newKyotoPlan.route.slug,
    ]);

    const occupiedVictoria = savePlannedRoute(victoria, victoriaIntent);
    expect(occupiedVictoria.created).toBe(false);
    expect(updatePlannedRouteIntent(
      newKyotoPlan.route.slug,
      victoriaIntent,
      victoria,
    )).toBeUndefined();
  });

  it("treats a same-place source change as a new temporal binding", () => {
    const kyoto = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "17654151284",
    )!;
    const alternateKyoto = {
      ...kyoto,
      id: "owner-route-alternate-kyoto",
      sourceRouteSlug: "alternate-kyoto-source",
      route: {
        ...kyoto.route,
        slug: "alternate-kyoto-source",
        trace: kyoto.route.trace.slice().reverse(),
      },
    };
    const saved = savePlannedRoute(
      kyoto,
      finderIntent,
      new Date("2026-07-14T12:00:00Z"),
    ).route;

    const rebound = updatePlannedRouteIntent(
      saved.slug,
      finderIntent,
      alternateKyoto,
      new Date("2026-08-16T12:00:00Z"),
    );

    expect(rebound).toMatchObject({
      slug: "planned-owner-route-alternate-kyoto",
      activityId: "planned:owner-route-alternate-kyoto",
      date: "2026-08-16",
      planning: {
        sourceRouteSlug: "alternate-kyoto-source",
        createdAt: "2026-08-16T12:00:00.000Z",
      },
    });
    expect(rebound?.trace).toEqual(alternateKyoto.route.trace);
  });

  it("removes a plan without touching the other saved plans", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const first = savePlannedRoute(candidate, finderIntent).route;
    const second = {
      ...first,
      slug: "planned-second-route",
      activityId: "planned:second-route",
      planning: { ...first.planning, candidateId: "second-route" },
    };
    window.localStorage.setItem(
      "godiesel.planned-routes.v1",
      encodePlannedRouteStore([first, second]),
    );

    expect(removePlannedRoute(first.slug)).toBe(true);
    expect(decodePlannedRouteStore(window.localStorage.getItem("godiesel.planned-routes.v1")))
      .toEqual([second]);
    expect(removePlannedRoute("planned-missing")).toBe(false);
  });

  it("fails closed when an edit or removal cannot be persisted", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const saved = savePlannedRoute(candidate, finderIntent).route;
    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(updatePlannedRouteIntent(saved.slug, { ...finderIntent, distanceKm: 30 }))
      .toBeUndefined();
    expect(removePlannedRoute(saved.slug)).toBe(false);
    expect(getPlannedRoutes()[0].planning.intent.distanceKm).toBe(21);
  });

  it("does not report or cache a new plan when persistence fails", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error("storage blocked");
    });

    const result = savePlannedRoute(candidate, finderIntent);

    expect(result).toMatchObject({ created: false, persisted: false });
    expect(getPlannedRoutes()).toEqual([]);
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

  it("rejects malformed nested intent without discarding valid sibling plans", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const valid = savePlannedRoute(candidate, finderIntent).route;
    const malformed = {
      ...valid,
      slug: "planned-malformed",
      planning: {
        ...valid.planning,
        candidateId: "malformed",
        intent: { ...valid.planning.intent, distanceKm: "far" },
      },
    };

    expect(decodePlannedRouteStore(JSON.stringify({
      version: 1,
      routes: [valid, malformed],
    }))).toEqual([valid]);
  });

  it("rejects a missing intent without discarding valid sibling plans", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const valid = savePlannedRoute(candidate, finderIntent).route;
    const malformed = {
      ...valid,
      slug: "planned-missing-intent",
      planning: {
        ...valid.planning,
        candidateId: "missing-intent",
        intent: undefined,
      },
    };

    expect(decodePlannedRouteStore(JSON.stringify({
      version: 1,
      routes: [valid, malformed],
    }))).toEqual([valid]);
  });

  it("rejects a persisted plan with an unknown provenance label", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const valid = savePlannedRoute(candidate, finderIntent).route;

    expect(decodePlannedRouteStore(JSON.stringify({
      version: 1,
      routes: [{
        ...valid,
        planning: { ...valid.planning, sourceLabel: "Generated by an unknown source" },
      }],
    }))).toEqual([]);
  });

  it("rejects a source snapshot that does not match its declared binding", () => {
    const kyoto = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "17654151284",
    )!;
    const victoria = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === "5650407638",
    )!;
    const valid = savePlannedRoute(kyoto, finderIntent).route;

    expect(decodePlannedRouteStore(JSON.stringify({
      version: 1,
      routes: [{
        ...valid,
        planning: { ...valid.planning, sourceSnapshot: victoria.route },
      }],
    }))).toEqual([]);
  });

  it("rejects a source snapshot that is not a completed recording", () => {
    const candidate = curatedRouteDiscoveryProvider.search(finderIntent).candidates[0];
    const valid = savePlannedRoute(candidate, finderIntent).route;

    expect(decodePlannedRouteStore(JSON.stringify({
      version: 1,
      routes: [{
        ...valid,
        planning: {
          ...valid.planning,
          sourceSnapshot: {
            ...valid.planning.sourceSnapshot,
            lifecycle: "discovered",
          },
        },
      }],
    }))).toEqual([]);
  });
});
