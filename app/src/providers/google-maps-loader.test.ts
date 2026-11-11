import { afterEach, describe, expect, it, vi } from "vitest";

import { loadGoogleMaps } from "@/providers/google-maps-loader";

class ScriptStub extends EventTarget {
  async = false;
  dataset: Record<string, string> = {};
  removed = false;
  src = "";

  remove() {
    this.removed = true;
  }
}

describe("loadGoogleMaps", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("removes a rejected script and permits a corrected retry", async () => {
    vi.useFakeTimers();
    const scripts: ScriptStub[] = [];
    const windowStub = Object.assign(new EventTarget(), {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    }) as unknown as Window;
    const documentStub = {
      createElement: () => new ScriptStub(),
      head: {
        append: (script: ScriptStub) => scripts.push(script),
      },
      querySelector: () => scripts.find((script) => !script.removed),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowStub,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentStub,
    });

    const rejected = loadGoogleMaps("rejected-key");
    expect(scripts).toHaveLength(1);
    windowStub.gm_authFailure?.();
    await expect(rejected).rejects.toThrow("rejected this browser key");
    expect(scripts[0].removed).toBe(true);

    const retried = loadGoogleMaps("corrected-key");
    expect(scripts).toHaveLength(2);
    windowStub.__godieselGoogleMapsReady?.();
    await expect(retried).resolves.toBeUndefined();
    expect(scripts[1].removed).toBe(false);
  });
});

describe("loadGoogleMaps authentication after load", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  });

  async function freshLoader() {
    vi.resetModules();
    vi.useFakeTimers();
    const scripts: ScriptStub[] = [];
    const authFailures: number[] = [];
    const windowStub = Object.assign(new EventTarget(), {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    }) as unknown as Window & { google?: unknown };
    windowStub.addEventListener("godiesel:google-maps-auth-failure", () => authFailures.push(Date.now()));
    Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new ScriptStub(),
        head: { append: (script: ScriptStub) => scripts.push(script) },
        querySelector: () => scripts.find((script) => !script.removed),
      },
    });
    const { loadGoogleMaps: load } = await import("@/providers/google-maps-loader");
    return { load, scripts, windowStub, authFailures };
  }

  it("keeps reporting a key rejection Google sends after the load callback", async () => {
    const { load, scripts, windowStub, authFailures } = await freshLoader();
    const loaded = load("rejected-key");
    windowStub.__godieselGoogleMapsReady?.();
    await expect(loaded).resolves.toBeUndefined();
    expect(typeof windowStub.gm_authFailure).toBe("function");
    windowStub.gm_authFailure?.();
    expect(authFailures).toHaveLength(1);
    expect(scripts[0].removed).toBe(false);
    expect(windowStub.__godieselGoogleMapsReady).toBeUndefined();
  });

  it("reports a rejection already received to a later load request in the same tick", async () => {
    const { load, windowStub, authFailures } = await freshLoader();
    const loaded = load("rejected-key");
    windowStub.__godieselGoogleMapsReady?.();
    await loaded;
    windowStub.gm_authFailure?.();
    windowStub.google = { maps: { importLibrary: () => undefined } };
    const again = load("rejected-key");
    expect(authFailures).toHaveLength(2);
    await expect(again).resolves.toBeUndefined();
  });

  it("installs one handler per page and restores the previous one after a failed load", async () => {
    const { load, scripts, windowStub } = await freshLoader();
    const previous = vi.fn();
    windowStub.gm_authFailure = previous;
    const failed = load("bad-network");
    scripts[0].dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow("could not be loaded");
    expect(windowStub.gm_authFailure).toBe(previous);
    const retried = load("good-key");
    const installed = windowStub.gm_authFailure;
    expect(installed).not.toBe(previous);
    windowStub.__godieselGoogleMapsReady?.();
    await retried;
    expect(windowStub.gm_authFailure).toBe(installed);
    installed?.();
    expect(previous).toHaveBeenCalledTimes(1);
  });
});
