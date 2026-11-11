import { afterEach, describe, expect, it, vi } from "vitest";

import { chunkFailure, recoverChunkLoad } from "@/app/chunk-recovery";

const chunkError = new TypeError(
  "Failed to fetch dynamically imported module: http://127.0.0.1/assets/finder-page-abc.js",
);

function stubBrowser(online: boolean) {
  const store = new Map<string, string>();
  const reload = vi.fn();
  vi.stubGlobal("navigator", { onLine: online });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal("window", { location: { reload } });
  return reload;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chunk failure", () => {
  it("is an offline failure when a view's code cannot download without a connection", () => {
    expect(chunkFailure(chunkError, false)).toBe("offline");
  });

  it("is an unavailable view when the code cannot download while online", () => {
    // A stale deploy: the old shell names a chunk the new release removed.
    expect(chunkFailure(chunkError, true)).toBe("unavailable");
  });

  it("is a plain view error for anything that is not a failed download", () => {
    expect(chunkFailure(new Error("boom"), false)).toBe("error");
    expect(chunkFailure(new Error("boom"), true)).toBe("error");
  });
});

describe("chunk recovery", () => {
  it("never reloads while offline, which would open the browser's offline page", () => {
    const reload = stubBrowser(false);

    expect(recoverChunkLoad(chunkError)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the shell once for a stale deploy, then leaves a manual retry", () => {
    const reload = stubBrowser(true);

    expect(recoverChunkLoad(chunkError)).toBe(true);
    expect(recoverChunkLoad(chunkError)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
