import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  decodeExternalPlans,
  saveExternalPlan,
  getExternalPlans,
  removeExternalPlan,
  externalPlanGpx,
  EXTERNAL_PLAN_KEY,
} from "./external-plan-store";
import { filterExternalPlans } from "@/surfaces/routes/external-plan-filters";
import { DEFAULT_ROUTE_FILTERS } from "@/surfaces/routes/route-filters";
import type { ExternalRoute } from "@/domain/search/external";
const route: ExternalRoute = {
  id: "osm-123",
  name: "Trail & creek",
  sourceUrl: "https://www.openstreetmap.org/relation/123",
  activity: "Run",
  distanceKm: 4,
  distanceKind: "mapped",
  lines: [
    [
      [1, 1],
      [2, 2],
    ],
    [
      [3, 3],
      [4, 4],
    ],
  ],
};
const intent = {
  place: "Banff",
  activity: "Run" as const,
  distanceKm: 0,
  terrain: "any" as const,
  vibe: "",
};
describe("external plans", () => {
  beforeEach(() => {
    const storage = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
      },
    });
  });
  it("persists source geometry separately, deduplicates and removes", () => {
    saveExternalPlan(route, "Banff", intent);
    saveExternalPlan(route, "Banff", intent);
    const plans = decodeExternalPlans(
      window.localStorage.getItem(EXTERNAL_PLAN_KEY),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].route.lines).toEqual(route.lines);
    expect(plans[0]).not.toHaveProperty("replay");
    removeExternalPlan(route.id);
    expect(getExternalPlans()).toEqual([]);
  });
  it("rejects malformed coordinates and untrusted source links", () => {
    expect(
      decodeExternalPlans(
        JSON.stringify({
          version: 1,
          plans: [
            {
              route: { ...route, sourceUrl: "javascript:alert(1)" },
              place: "Banff",
              createdAt: "now",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
  it("reports storage failures instead of pretending a save succeeded", () => {
    window.localStorage.setItem = () => {
      throw Error("QuotaExceeded");
    };
    expect(() => saveExternalPlan(route, "Banff", intent)).toThrow();
    expect(getExternalPlans()).toEqual([]);
  });
  it("exports separate GPX segments without invented elevations or timestamps", () => {
    const xml = externalPlanGpx(route);
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml).toContain("Trail &amp; creek");
    expect(xml).not.toContain("<ele>");
    expect(xml).not.toContain("<time>");
  });
  it("excludes unknown climbs from climb filters and plans from completed", () => {
    const plans = [{ route, place: "Banff", createdAt: "now", intent }];
    expect(filterExternalPlans(plans, DEFAULT_ROUTE_FILTERS)).toHaveLength(1);
    expect(
      filterExternalPlans(plans, {
        ...DEFAULT_ROUTE_FILTERS,
        climb: "under-250",
      }),
    ).toEqual([]);
    expect(
      filterExternalPlans(plans, {
        ...DEFAULT_ROUTE_FILTERS,
        lifecycle: "completed",
      }),
    ).toEqual([]);
  });
});

it('rejects corrupt optional surface metadata',()=>{
  expect(decodeExternalPlans(JSON.stringify({version:1,plans:[{route:{...route,surfaces:[42]},place:'Banff',createdAt:'now'}]}))).toEqual([]);
});
