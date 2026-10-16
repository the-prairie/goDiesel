import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestRoute } from "@/domain/route";
import type { ReplayPose } from "../playback/replay-controller";
import { MapLibreAtlasReplayEngine } from "./maplibre-replay-engine";

const provider = vi.hoisted(() => {
  const maps: MapDouble[] = [];
  class MapDouble {
    listeners = new Map<string, Array<() => void>>();
    addControl = vi.fn();
    resize = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    remove = vi.fn();
    constructor() {
      maps.push(this);
    }
    on(event: string, callback: () => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        callback,
      ]);
    }
    once(event: string, callback: () => void) {
      this.on(event, callback);
    }
    emit(event: string) {
      this.listeners.get(event)?.forEach((callback) => callback());
    }
  }
  return { maps, MapDouble };
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
});
