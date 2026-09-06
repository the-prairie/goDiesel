import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldTaskQueue } from "./world-tile-scheduling";

afterEach(() => vi.useRealTimers());

describe("Cinematic tile scheduling", () => {
  it("continues decoding without a rendered animation frame, in bounded batches", async () => {
    vi.useFakeTimers();
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const queue = new WorldTaskQueue();
    queue.maxJobs = 2;
    let active = 0, maximum = 0;
    const jobs = Array.from({ length: 8 }, (_, i) => queue.add(i, async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return i;
    }));
    await vi.runAllTimersAsync();
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maximum).toBe(2);
    expect(raf).not.toHaveBeenCalled();
    queue.dispose();
    vi.unstubAllGlobals();
  });

  it("cancels queued work and wakes on teardown, without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const queue = new WorldTaskQueue();
    const callback = vi.fn();
    const pending = queue.add({}, callback).catch(error => error.name);
    queue.dispose();
    await vi.runAllTimersAsync();
    expect(await pending).toBe("AbortError");
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

});
