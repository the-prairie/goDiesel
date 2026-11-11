import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const photo = "data:image/jpeg;base64,/9j/AA==";
let storage: Map<string, string>;
let store: typeof import("./replay-marker-preference");
beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    }),
  );
  store = await import("./replay-marker-preference");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared replay marker preference", () => {
  it.each([
    "{",
    "{}",
    JSON.stringify({ version: 2, kind: "dot" }),
    JSON.stringify({
      version: 1,
      kind: "photo",
      photo: "https://example.com/me.jpg",
    }),
    JSON.stringify({
      version: 1,
      kind: "photo",
      photo: "data:image/svg+xml;base64,AA==",
    }),
  ])("falls back to the dot for invalid stored data %s", (raw) => {
    expect(store.parseReplayMarker(raw)).toEqual({ kind: "dot" });
  });
  it("saves the photo and retains it while using the dot", () => {
    store.saveReplayMarker({ kind: "photo", photo });
    expect(store.getReplayMarker()).toEqual({ kind: "photo", photo });
    store.saveReplayMarker({ kind: "dot", photo });
    expect(
      store.parseReplayMarker(storage.get(store.REPLAY_MARKER_KEY)!),
    ).toEqual({ kind: "dot", photo });
    store.saveReplayMarker({ kind: "dot" });
    expect(store.getReplayMarker()).toEqual({ kind: "dot" });
  });
  it("reports storage failures without changing the active marker", () => {
    const notify = vi.fn();
    const cleanup = store.subscribeReplayMarker(notify);
    window.localStorage.setItem = () => {
      throw new Error("Quota");
    };
    expect(() => store.saveReplayMarker({ kind: "photo", photo })).toThrow(
      "could not save",
    );
    expect(store.getReplayMarker()).toEqual({ kind: "dot" });
    expect(notify).not.toHaveBeenCalled();
    cleanup();
  });
  it("updates subscribers in the same window and on cross-tab storage changes", () => {
    const notify = vi.fn();
    const cleanup = store.subscribeReplayMarker(notify);
    store.saveReplayMarker({ kind: "photo", photo });
    expect(notify).toHaveBeenCalledTimes(1);
    storage.set(
      store.REPLAY_MARKER_KEY,
      JSON.stringify({ version: 1, kind: "dot", photo }),
    );
    window.dispatchEvent(
      Object.assign(new Event("storage"), { key: store.REPLAY_MARKER_KEY }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(store.getReplayMarker().kind).toBe("dot");
    cleanup();
    window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
