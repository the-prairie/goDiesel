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
