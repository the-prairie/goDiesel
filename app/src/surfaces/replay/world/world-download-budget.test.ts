import { afterEach, describe, expect, it, vi } from "vitest";
import { availableDownloadSlots, WorldDownloadQueue } from "./world-download-budget";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("download/decode backpressure", () => {
  it("reserves remaining decode capacity rather than flooding the parser", () => {
    expect(availableDownloadSlots({ downloading: 8, parsing: 16 }, 3, 8)).toBe(3);
    expect(availableDownloadSlots({ downloading: 4, parsing: 18 }, 1, 8)).toBe(3);
    expect(availableDownloadSlots({ downloading: 0, parsing: 0 }, 0, 8)).toBe(8);
    expect(availableDownloadSlots({ downloading: 0, parsing: 228 }, 0, 8)).toBe(0);
  });
  it("bounds real PriorityQueue work across origins, drains and never needs a GPU frame", async () => {
    vi.useFakeTimers(); vi.stubGlobal("requestAnimationFrame", vi.fn());
    const work = { downloading: 0, parsing: 0 };
    const queue = new WorldDownloadQueue(() => work, 12); queue.maxJobsPerOrigin = 8;
    let peak = 0, finished = 0;
    const jobs = Array.from({ length: 80 }, (_, i) => queue.add(`https://tiles-${i % 2}.example/tile`, { i }, async () => {
      work.downloading++;
      peak = Math.max(peak, work.downloading + work.parsing);
      await new Promise(resolve => setTimeout(resolve, 3));
      work.downloading--; work.parsing++;
      // Model a response returning well before its body/decoder finishes.
      setTimeout(() => { work.parsing--; finished++; }, 50);
    }));
    await vi.advanceTimersByTimeAsync(20);
    expect(queue.blocked).toBe(true);
    expect(finished).toBe(0);
    await vi.runAllTimersAsync(); await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(12);
    expect(finished).toBe(80);
    queue.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels blocked work without starting requests or leaking timers", async () => {
    vi.useFakeTimers(); vi.stubGlobal("requestAnimationFrame", vi.fn());
    const queue = new WorldDownloadQueue(() => ({ downloading: 0, parsing: 24 }));
    const run = vi.fn(); const abort = new AbortController();
    const pending = queue.add("https://tiles.example/a", {}, run, abort.signal).catch(e => e.name);
    await vi.advanceTimersByTimeAsync(50); abort.abort(); queue.dispose();
    expect(await pending).toBe("AbortError");
    expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
