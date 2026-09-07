import { DownloadPriorityQueue, type PriorityQueue } from "3d-tiles-renderer/core";

export interface WorldPendingWork { downloading: number; parsing: number; }
export const WORLD_PENDING_LIMIT = 24;

/** Count response bodies too: the dependency releases its HTTP slot before decoding. */
export function availableDownloadSlots(work: WorldPendingWork, active: number, perOrigin: number, limit = WORLD_PENDING_LIMIT) {
  const remaining = Math.max(0, limit - work.downloading - work.parsing);
  return Math.min(perOrigin, active + remaining);
}

// Narrow, checked compatibility boundary for the pinned PriorityQueue 0.5.2.
interface QueueState extends PriorityQueue { currJobs: number; items: unknown[]; }
function inspect(queue: PriorityQueue): QueueState {
  const state = queue as QueueState;
  if (typeof state.currJobs !== "number" || !Array.isArray(state.items)) throw new Error("World download queue contract changed");
  return state;
}

/**
 * Backpressure before HTTP work starts, not after hundreds of bodies accumulate.
 * All origins share one decode allowance. The library still owns cancellation,
 * cache accounting, auth, priority order and the full tile lifecycle.
 */
export class WorldDownloadQueue extends DownloadPriorityQueue {
  private readonly bound = new WeakSet<PriorityQueue>();
  private readonly wakes = new Map<PriorityQueue, ReturnType<typeof setTimeout>>();
  private closed = false;
  constructor(private readonly work: () => WorldPendingWork, readonly limit = WORLD_PENDING_LIMIT) { super(); }

  override add(url: string | null, item: object, callback: (item: object) => unknown, signal?: AbortSignal | null): Promise<unknown> {
    if (this.closed) return Promise.reject(new DOMException("World disposed", "AbortError"));
    const promise = super.add(url, item, callback, signal);
    for (const queue of this.originQueues.values()) {
      if (this.bound.has(queue)) continue;
      const state = inspect(queue), run = queue.tryRunJobs.bind(queue);
      this.bound.add(queue);
      queue.scheduleJobRun = () => this.wake(queue, 4);
      queue.tryRunJobs = () => {
        if (this.closed) return;
        queue.maxJobs = availableDownloadSlots(this.work(), state.currJobs, this.maxJobsPerOrigin, this.limit);
        run();
        // A blocked download must wake when body/parse work drains, even if no
        // expensive animation frame is presented. One timer per active origin.
        if (state.items.length) this.wake(queue, 16);
      };
      queue.scheduleJobRun();
    }
    return promise;
  }
  private wake(queue: PriorityQueue, delay: number) {
    if (this.closed || this.wakes.has(queue)) return;
    this.wakes.set(queue, setTimeout(() => {
      this.wakes.delete(queue);
      queue.tryRunJobs();
    }, delay));
  }
  get blocked() { return this.work().downloading + this.work().parsing >= this.limit; }
  dispose() {
    this.closed = true;
    for (const timer of this.wakes.values()) clearTimeout(timer);
    this.wakes.clear();
    for (const queue of this.originQueues.values()) queue.removeByFilter(() => true);
  }
}
