import { afterEach, describe, expect, it, vi } from "vitest";

import apiKeyInvalidBody from "@/providers/fixtures/google-tiles-root-api-key-invalid.json";
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

describe("loadGoogleMaps key preflight", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const invalidKeyAnswer = () => new Response(JSON.stringify(apiKeyInvalidBody), { status: 400 });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  });

  async function freshLoader(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, storage = new Map<string, string>()) {
    vi.resetModules();
    vi.useFakeTimers();
    const scripts: ScriptStub[] = [];
    const authFailures: number[] = [];
    const fetchMock = vi.fn(fetchImpl);
    const windowStub = Object.assign(new EventTarget(), {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      fetch: fetchMock,
      sessionStorage: {
        getItem: (name: string) => storage.get(name) ?? null,
        setItem: (name: string, value: string) => storage.set(name, value),
      },
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
    return { load, scripts, windowStub, authFailures, fetchMock, storage };
  }

  it("reports an invalid key once while the API is still loading, and to every later load", async () => {
    const { load, scripts, windowStub, authFailures, fetchMock } = await freshLoader(async () => invalidKeyAnswer());
    const loading = load("rejected-key");
    expect(scripts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(authFailures).toHaveLength(1);

    const joined = load("rejected-key");
    expect(authFailures).toHaveLength(2);
    windowStub.__godieselGoogleMapsReady?.();
    await expect(loading).resolves.toBeUndefined();
    await expect(joined).resolves.toBeUndefined();

    windowStub.google = { maps: { importLibrary: () => undefined } };
    await expect(load("rejected-key")).resolves.toBeUndefined();
    expect(authFailures).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a served tileset", async () => new Response(JSON.stringify({ asset: { version: "1.0" } }), { status: 200 })],
    ["a referrer restriction", async () => new Response(JSON.stringify({
      error: { status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] },
    }), { status: 403 })],
    ["a network failure", async () => { throw new TypeError("Failed to fetch"); }],
  ])("leaves the load untouched after %s", async (_name, answer) => {
    const { load, scripts, windowStub, authFailures } = await freshLoader(answer);
    const loading = load("some-key");
    await vi.advanceTimersByTimeAsync(0);
    windowStub.__godieselGoogleMapsReady?.();
    await expect(loading).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(authFailures).toHaveLength(0);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].removed).toBe(false);
    expect(typeof windowStub.gm_authFailure).toBe("function");
  });

  it("never waits for the preflight: the API resolves while the check is still pending", async () => {
    let answer: ((response: Response) => void) | undefined;
    const { load, windowStub, authFailures } = await freshLoader(() => new Promise((resolve) => { answer = resolve; }));
    const order: string[] = [];
    const loading = load("slow-check-key").then(() => order.push("loaded"));
    windowStub.__godieselGoogleMapsReady?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["loaded"]);
    expect(authFailures).toHaveLength(0);
    answer?.(invalidKeyAnswer());
    await vi.advanceTimersByTimeAsync(0);
    await loading;
    expect(authFailures).toHaveLength(1);
  });

  it("does not report a check that timed out", async () => {
    const { load, windowStub, authFailures } = await freshLoader((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const loading = load("hanging-key");
    windowStub.__godieselGoogleMapsReady?.();
    await loading;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(authFailures).toHaveLength(0);
  });

  it("answers from the session cache without a second request", async () => {
    const storage = new Map<string, string>();
    const first = await freshLoader(async () => invalidKeyAnswer(), storage);
    first.load("rejected-key");
    await vi.advanceTimersByTimeAsync(0);
    expect(first.fetchMock).toHaveBeenCalledTimes(1);

    const reloaded = await freshLoader(async () => invalidKeyAnswer(), storage);
    reloaded.load("rejected-key");
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.fetchMock).not.toHaveBeenCalled();
    expect(reloaded.authFailures).toHaveLength(1);
  });

  it("ignores a cached rejection once the key changes", async () => {
    const storage = new Map<string, string>();
    const first = await freshLoader(async () => invalidKeyAnswer(), storage);
    first.load("old-key");
    await vi.advanceTimersByTimeAsync(0);

    const redeployed = await freshLoader(async () => new Response("{}", { status: 200 }), storage);
    redeployed.load("new-key");
    await vi.advanceTimersByTimeAsync(0);
    expect(redeployed.fetchMock).toHaveBeenCalledTimes(1);
    expect(redeployed.authFailures).toHaveLength(0);
  });

  it("makes no request for a missing or blanked key", async () => {
    const { load, fetchMock, authFailures } = await freshLoader(async () => invalidKeyAnswer());
    void load("").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(authFailures).toHaveLength(0);
  });
});
