import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldParseQueue } from "./world-parse-queue";

describe("instance-owned terrain decoding", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drains downloaded tiles without requesting a graphics frame", async () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const queue = new WorldParseQueue();
    const tasks = Array.from({ length: 50 }, (_, i) => queue.add(i, async (value) => value));
    await vi.runAllTimersAsync();
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(raf).not.toHaveBeenCalled();
    queue.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps concurrency bounded and preserves the renderer's priority order", async () => {
    const queue = new WorldParseQueue();
    queue.maxJobs = 2;
    queue.priorityCallback = (a: number, b: number) => a - b;
    const started: number[] = [];
    const finish: (() => void)[] = [];
    const tasks = [1, 3, 2].map((value) => queue.add(value, () => {
      started.push(value);
      return new Promise<void>((resolve) => finish.push(resolve));
    }));
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([3, 2]);
    finish.shift()?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([3, 2, 1]);
    finish.forEach((resolve) => resolve());
    await Promise.all(tasks);
    await vi.runAllTimersAsync();
    expect(queue.running).toBe(false);
    queue.dispose();
  });

  it("yields when hidden, then resumes instead of spinning or losing work", async () => {
    let visible = false;
    const queue = new WorldParseQueue(() => visible);
    const work = vi.fn();
    const task = queue.add(1, work);
    await vi.advanceTimersByTimeAsync(1000);
    expect(work).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(250);
    await task;
    expect(work).toHaveBeenCalledOnce();
    queue.dispose();
  });

  it("cancels pending work and timers when leaving Replay", async () => {
    const queue = new WorldParseQueue();
    const work = vi.fn();
    const task = queue.add(1, work).catch((error: Error) => error.name);
    queue.dispose();
    await vi.runAllTimersAsync();
    expect(await task).toBe("AbortError");
    expect(work).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
