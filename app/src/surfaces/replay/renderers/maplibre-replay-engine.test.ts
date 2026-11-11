import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestRoute } from "@/domain/route";
import type { ReplayPose } from "../playback/replay-controller";
import { MapLibreAtlasReplayEngine } from "./maplibre-replay-engine";

const provider = vi.hoisted(() => {
  const maps: MapDouble[] = [];
  const construction: { error?: Error; timersAtConstruction: number[] } = {
    timersAtConstruction: [],
  };
  class MapDouble {
    listeners = new Map<string, Array<(event?: unknown) => void>>();
    zoom = 13;
    getZoom = vi.fn(() => this.zoom);
    addControl = vi.fn();
    resize = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    remove = vi.fn();
    constructor() {
      construction.timersAtConstruction.push(vi.getTimerCount());
      if (construction.error) throw construction.error;
      maps.push(this);
    }
    on(event: string, callback: (event?: unknown) => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        callback,
      ]);
    }
    once(event: string, callback: (event?: unknown) => void) {
      this.on(event, callback);
    }
    emit(event: string, payload?: unknown) {
      this.listeners.get(event)?.forEach((callback) => callback(payload));
    }
  }
  return { maps, MapDouble, construction };
});
vi.mock("@/providers/maplibre", () => ({
  default: {
    NavigationControl: class {},
    Map: provider.MapDouble,
  },
}));

const route = {
  route: [
    { lat: 35, lng: 135, elev: 100 },
    { lat: 35.01, lng: 135.01, elev: 120 },
  ],
} as QuestRoute;
const pose: ReplayPose = {
  lat: 35,
  lng: 135,
  elev: 100,
  progressM: 0,
  progressRatio: 0,
  bearingDeg: 20,
  cameraRangeM: 240,
  following: true,
};

async function mount(selectedRoute = route) {
  const engine = new MapLibreAtlasReplayEngine();
  const onStatus = vi.fn();
  const container = { replaceChildren: vi.fn() } as unknown as HTMLElement;
  await engine.mount({ container, route: selectedRoute, onStatus });
  return {
    engine,
    onStatus,
    container,
    map: provider.maps.at(-1)!,
    states: () => onStatus.mock.calls.map(([status]) => status.state),
  };
}

describe("MapLibre Replay lifecycle contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    provider.maps.length = 0;
    provider.construction.error = undefined;
    provider.construction.timersAtConstruction.length = 0;
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("document", {
      createElement: () => ({ className: "", remove: vi.fn() }),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports missing geometry without creating provider resources", async () => {
    const h = await mount({ route: [] } as unknown as QuestRoute);
    expect(h.states()).toEqual(["loading", "unavailable"]);
    expect(h.onStatus.mock.calls[1][0].title).toBe(
      "Route geometry unavailable",
    );
    expect(provider.maps).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    h.engine.destroy();
  });

  it("reports the fourth and subsequent pre-load errors", async () => {
    const h = await mount();
    for (let i = 0; i < 3; i++) h.map.emit("error");
    expect(h.states()).toEqual(["loading"]);
    h.map.emit("error");
    h.map.emit("error");
    expect(h.states()).toEqual(["loading", "unavailable", "unavailable"]);
    expect(h.onStatus.mock.calls[1][0].title).toBe("Atlas replay unavailable");
    h.engine.destroy();
  });

  it("keeps the deadline after an error outcome and recovers on late load", async () => {
    const h = await mount();
    for (let i = 0; i < 4; i++) h.map.emit("error");
    await vi.advanceTimersByTimeAsync(14999);
    expect(h.states()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.onStatus.mock.calls[2][0].title).toBe("Atlas replay timed out");
    h.map.emit("load");
    expect(h.states()).toEqual([
      "loading",
      "unavailable",
      "unavailable",
      "ready",
    ]);
    expect(h.map.addSource).toHaveBeenCalledWith(
      "replay-route",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(h.map.addLayer).toHaveBeenCalledTimes(2);
    expect(h.map.fitBounds).toHaveBeenCalledOnce();
    h.engine.destroy();
  });

  it("does not repeat a timeout outcome until the fourth later error", async () => {
    const h = await mount();
    await vi.advanceTimersByTimeAsync(15000);
    for (let i = 0; i < 3; i++) h.map.emit("error");
    expect(h.states()).toEqual(["loading", "unavailable"]);
    h.map.emit("error");
    expect(h.onStatus.mock.calls[2][0].title).toBe("Atlas replay unavailable");
    h.engine.destroy();
  });

  it("reports a map that cannot be constructed (no WebGL2) at once, without waiting for the deadline", async () => {
    provider.construction.error = new Error("Failed to initialize WebGL");
    const h = await mount();
    expect(h.states()).toEqual(["loading", "unavailable"]);
    expect(h.onStatus.mock.calls[1][0].title).toBe(
      "Atlas replay isn\u2019t supported here",
    );
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.states()).toEqual(["loading", "unavailable"]);
    h.engine.setPose(pose);
    h.engine.destroy();
    expect(h.states()).toEqual(["loading", "unavailable"]);
  });

  it("arms the load deadline before it touches the map provider", async () => {
    const h = await mount();
    expect(provider.construction.timersAtConstruction).toEqual([1]);
    h.engine.destroy();
  });

  it("cancels the deadline and ignores error outcomes after readiness", async () => {
    const h = await mount();
    h.map.emit("load");
    for (let i = 0; i < 6; i++) h.map.emit("error");
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.states()).toEqual(["loading", "ready"]);
    expect(vi.getTimerCount()).toBe(0);
    h.engine.destroy();
  });

  it("gates camera movement on load and following while preserving range presets", async () => {
    const h = await mount();
    h.engine.setPose(pose);
    expect(h.map.jumpTo).not.toHaveBeenCalled();
    h.map.emit("load");
    h.engine.setPose({ ...pose, following: false });
    expect(h.map.jumpTo).not.toHaveBeenCalled();
    for (const [cameraRangeM, zoom] of [
      [120, 17],
      [240, 16],
      [720, 14.5],
      [1400, 13.5],
    ]) {
      h.engine.setPose({ ...pose, cameraRangeM });
      expect(h.map.jumpTo).toHaveBeenLastCalledWith({
        center: [135, 35],
        bearing: 20,
        zoom,
        pitch: 52,
      });
    }
    h.engine.destroy();
  });

  it("characterization: a zoom made on the map itself is overwritten by the next follow pose", async () => {
    const h = await mount();
    h.map.emit("load");
    h.engine.setPose(pose);
    expect(h.map.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 16 }));
    // The person zooms out with MapLibre's own control or a pinch.
    h.map.zoom = 12;
    h.map.emit("zoomend", { originalEvent: {} });
    // Play (or any later pose) re-derives the zoom from the session's range.
    h.engine.setPose({ ...pose, progressM: 10 });
    expect(h.map.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 16 }));
    h.engine.destroy();
  });

  it("disposes pending resources and rejects late provider callbacks", async () => {
    const h = await mount();
    h.engine.destroy();
    h.map.emit("load");
    for (let i = 0; i < 5; i++) h.map.emit("error");
    await vi.advanceTimersByTimeAsync(20000);
    h.engine.setPose(pose);
    expect(h.states()).toEqual(["loading"]);
    expect(h.map.remove).toHaveBeenCalledOnce();
    expect(h.map.addSource).not.toHaveBeenCalled();
    expect(h.map.jumpTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates retired callbacks when the same engine is mounted after disposal", async () => {
    const h = await mount();
    h.engine.destroy();
    const nextStatus = vi.fn();
    await h.engine.mount({
      container: h.container,
      route,
      onStatus: nextStatus,
    });
    h.map.emit("load");
    h.map.emit("error");
    const next = provider.maps.at(-1)!;
    expect(nextStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
    ]);
    h.engine.setPose(pose);
    expect(next.jumpTo).not.toHaveBeenCalled();
    next.emit("load");
    h.engine.setPose(pose);
    expect(nextStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
    expect(next.jumpTo).toHaveBeenCalledOnce();
    h.engine.destroy();
  });

  describe("status characterization", () => {
    const LOADING = {
      state: "loading",
      title: "Opening Atlas replay",
      message: "Loading the route map and replay thread.",
    };
    const READY = {
      state: "ready",
      title: "Atlas replay ready",
      message: "The fallback route thread is ready to move.",
    };
    const GEOMETRY = {
      state: "unavailable",
      title: "Route geometry unavailable",
      message: "This route does not contain enough points for Atlas replay.",
    };
    const ERRORS = {
      state: "unavailable",
      title: "Atlas replay unavailable",
      message: "The fallback map could not load in this browser session.",
    };
    const DEADLINE = {
      state: "unavailable",
      title: "Atlas replay timed out",
      message: "The fallback map did not become ready in time.",
    };
    const payloads = (onStatus: ReturnType<typeof vi.fn>) =>
      onStatus.mock.calls.map(([status]) => status);
    async function remount(
      h: Awaited<ReturnType<typeof mount>>,
      selectedRoute = route,
    ) {
      const onStatus = vi.fn();
      await h.engine.mount({
        container: h.container,
        route: selectedRoute,
        onStatus,
      });
      return onStatus;
    }

    it("successful load", async () => {
      const h = await mount();
      h.map.emit("load");
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(h.onStatus)).toEqual([LOADING, READY]);
      h.engine.destroy();
    });

    it.each([
      ["missing", []],
      ["insufficient", route.route.slice(0, 1)],
    ])("rejects %s geometry", async (_label, points) => {
      const h = await mount({ route: points } as unknown as QuestRoute);
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(h.onStatus)).toEqual([LOADING, GEOMETRY]);
      expect(provider.maps).toHaveLength(0);
      h.engine.destroy();
    });

    it("reports provider errors on the fourth and every later pre-load error", async () => {
      const h = await mount();
      for (let i = 0; i < 5; i++) h.map.emit("error");
      expect(payloads(h.onStatus)).toEqual([LOADING, ERRORS, ERRORS]);
      h.engine.destroy();
    });

    it("reports the provider deadline, later errors and a late load", async () => {
      const h = await mount();
      await vi.advanceTimersByTimeAsync(15000);
      for (let i = 0; i < 4; i++) h.map.emit("error");
      h.map.emit("load");
      expect(payloads(h.onStatus)).toEqual([LOADING, DEADLINE, ERRORS, READY]);
      h.engine.destroy();
    });

    it("reports errors, then the deadline, then a late load", async () => {
      const h = await mount();
      for (let i = 0; i < 4; i++) h.map.emit("error");
      await vi.advanceTimersByTimeAsync(15000);
      h.map.emit("load");
      expect(payloads(h.onStatus)).toEqual([LOADING, ERRORS, DEADLINE, READY]);
      h.engine.destroy();
    });

    it("destroy during load publishes nothing further", async () => {
      const h = await mount();
      h.engine.destroy();
      for (let i = 0; i < 5; i++) h.map.emit("error");
      h.map.emit("load");
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
    });

    it("destroy after ready publishes nothing further", async () => {
      const h = await mount();
      h.map.emit("load");
      h.engine.destroy();
      for (let i = 0; i < 5; i++) h.map.emit("error");
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(h.onStatus)).toEqual([LOADING, READY]);
    });

    it("a remount after destroy drops the retired run's callbacks", async () => {
      const h = await mount();
      h.engine.destroy();
      const nextStatus = await remount(h);
      const next = provider.maps.at(-1)!;
      for (let i = 0; i < 5; i++) h.map.emit("error");
      h.map.emit("load");
      next.emit("load");
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(nextStatus)).toEqual([LOADING, READY]);
      h.engine.destroy();
    });

    it("a remount without destroy drops the replaced run's callbacks", async () => {
      const h = await mount();
      const nextStatus = await remount(h);
      const next = provider.maps.at(-1)!;
      for (let i = 0; i < 5; i++) h.map.emit("error");
      h.map.emit("load");
      await vi.advanceTimersByTimeAsync(15000);
      expect(h.map.addSource).not.toHaveBeenCalled();
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(nextStatus)).toEqual([LOADING, DEADLINE]);
      next.emit("load");
      expect(payloads(nextStatus)).toEqual([LOADING, DEADLINE, READY]);
      h.engine.destroy();
    });

    it("readiness stays sticky through a remount without destroy", async () => {
      const h = await mount();
      h.map.emit("load");
      const nextStatus = await remount(h);
      const next = provider.maps.at(-1)!;
      h.engine.setPose(pose);
      expect(next.jumpTo).toHaveBeenCalledOnce();
      for (let i = 0; i < 5; i++) next.emit("error");
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(nextStatus)).toEqual([LOADING]);
      next.emit("load");
      expect(payloads(h.onStatus)).toEqual([LOADING, READY]);
      expect(payloads(nextStatus)).toEqual([LOADING, READY]);
      h.engine.destroy();
    });

    it("the error budget carries through a remount without destroy", async () => {
      const h = await mount();
      for (let i = 0; i < 4; i++) h.map.emit("error");
      const nextStatus = await remount(h);
      const next = provider.maps.at(-1)!;
      next.emit("error");
      next.emit("load");
      expect(payloads(h.onStatus)).toEqual([LOADING, ERRORS]);
      expect(payloads(nextStatus)).toEqual([LOADING, ERRORS, READY]);
      h.engine.destroy();
    });

    it("rejected geometry after a ready run without destroy", async () => {
      const h = await mount();
      h.map.emit("load");
      const nextStatus = await remount(h, {
        route: [],
      } as unknown as QuestRoute);
      await vi.advanceTimersByTimeAsync(20000);
      expect(payloads(nextStatus)).toEqual([LOADING, GEOMETRY]);
      expect(provider.maps).toHaveLength(1);
      h.engine.destroy();
    });

    it("a remount without destroy after rejected geometry loads normally", async () => {
      const h = await mount({ route: [] } as unknown as QuestRoute);
      const nextStatus = await remount(h);
      provider.maps.at(-1)!.emit("load");
      expect(payloads(h.onStatus)).toEqual([LOADING, GEOMETRY]);
      expect(payloads(nextStatus)).toEqual([LOADING, READY]);
      h.engine.destroy();
    });
  });
});
