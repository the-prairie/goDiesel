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

describe("planned route store when storage rejects a write", () => {
  type StoreModule = typeof import("@/data/planned-route-store");

  let values: Map<string, string>;
  let rejectWrites: boolean;
  let storageListener: ((event: { key: string | null }) => void) | undefined;
  let store: StoreModule;

  beforeEach(async () => {
    values = new Map<string, string>();
    rejectWrites = false;
    storageListener = undefined;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (rejectWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
          values.set(key, value);
        },
      },
      addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
        if (type === "storage") storageListener = listener;
      },
      removeEventListener: vi.fn(),
    });
    vi.resetModules();
    store = await import("@/data/planned-route-store");
  });

  function candidates() {
    const [first] = curatedRouteDiscoveryProvider.search(finderIntent).candidates;
    return [first, { ...first, id: `${first.id}-second` }];
  }

  it("keeps a rejected save for this tab and reports memory-only storage", () => {
    rejectWrites = true;
    const [candidate] = candidates();

    const result = store.savePlannedRoute(candidate, finderIntent);

    expect(result.created).toBe(true);
    expect(store.getPlannedRoutes()).toEqual([result.route]);
    expect(store.getPlannedRoutes()).toEqual([result.route]);
    expect(store.getPlannedRouteStorageStatus()).toBe("memory-only");
  });

  it("returns to persisted storage when a later write succeeds", () => {
    const [first, second] = candidates();
    rejectWrites = true;
    const unsaved = store.savePlannedRoute(first, finderIntent).route;

    rejectWrites = false;
    const saved = store.savePlannedRoute(second, finderIntent).route;

    expect(store.getPlannedRouteStorageStatus()).toBe("persisted");
    expect(store.decodePlannedRouteStore(values.get(store.PLANNED_ROUTE_STORAGE_KEY) ?? null))
      .toEqual([unsaved, saved]);
    expect(store.getPlannedRoutes()).toEqual([unsaved, saved]);
  });

  it("does not drop the unsaved plan when another tab changes storage", () => {
    const unsubscribe = store.subscribePlannedRoutes(() => {});
    const [first, second] = candidates();
    rejectWrites = true;
    const unsaved = store.savePlannedRoute(first, finderIntent).route;

    values.set(
      store.PLANNED_ROUTE_STORAGE_KEY,
      store.encodePlannedRouteStore([{ ...unsaved, slug: "planned-other-tab", planning: { ...unsaved.planning, candidateId: second.id } }]),
    );
    storageListener?.({ key: store.PLANNED_ROUTE_STORAGE_KEY });

    expect(store.getPlannedRoutes()).toEqual([unsaved]);
    expect(store.getPlannedRouteStorageStatus()).toBe("memory-only");
    unsubscribe();
  });

  it("still follows other tabs while storage is persisted", () => {
    const unsubscribe = store.subscribePlannedRoutes(() => {});
    const [first] = candidates();
    const saved = store.savePlannedRoute(first, finderIntent).route;

    values.set(store.PLANNED_ROUTE_STORAGE_KEY, store.encodePlannedRouteStore([]));
    storageListener?.({ key: store.PLANNED_ROUTE_STORAGE_KEY });

    expect(saved.lifecycle).toBe("planned");
    expect(store.getPlannedRoutes()).toEqual([]);
    expect(store.getPlannedRouteStorageStatus()).toBe("persisted");
    unsubscribe();
  });

  it("returns a stable snapshot between reads", () => {
    rejectWrites = true;
    store.savePlannedRoute(candidates()[0], finderIntent);

    expect(store.getPlannedRoutes()).toBe(store.getPlannedRoutes());
  });
});

describe("planned route cache transitions", () => {
  it("replaces persisted routes from a changed raw read and keeps the same state otherwise", async () => {
    const { reducePlannedRouteCache, initialPlannedRouteCache, encodePlannedRouteStore } =
      await import("@/data/planned-route-store");
    const read = reducePlannedRouteCache(initialPlannedRouteCache, { type: "storageRead", raw: null });
    expect(read).toEqual({ mode: "persisted", raw: null, routes: [] });
    expect(reducePlannedRouteCache(read, { type: "storageRead", raw: null })).toBe(read);
    const empty = encodePlannedRouteStore([]);
    expect(reducePlannedRouteCache(read, { type: "storageRead", raw: empty })).toMatchObject({
      mode: "persisted",
      raw: empty,
    });
  });

  it("ignores storage reads and changes while memory-only", async () => {
    const { reducePlannedRouteCache, initialPlannedRouteCache } = await import(
      "@/data/planned-route-store"
    );
    const memoryOnly = reducePlannedRouteCache(initialPlannedRouteCache, {
      type: "writeRejected",
      raw: "unsaved",
      routes: [],
    });
    expect(memoryOnly.mode).toBe("memory-only");
    expect(reducePlannedRouteCache(memoryOnly, { type: "storageRead", raw: null })).toBe(memoryOnly);
    expect(reducePlannedRouteCache(memoryOnly, { type: "storageChanged" })).toBe(memoryOnly);
    expect(
      reducePlannedRouteCache(memoryOnly, { type: "writeAccepted", raw: "saved", routes: [] }),
    ).toEqual({ mode: "persisted", raw: "saved", routes: [] });
  });
});
