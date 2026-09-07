import { PriorityQueue } from "3d-tiles-renderer/core";

/**
 * Decoding must not wait for an expensive GPU frame. The library's default queue
 * is shared between all worlds and wakes on requestAnimationFrame. A coarse first
 * tile plus atmospheric shaders can therefore prevent its own finer replacements
 * from being decoded. Use small, yielding task batches owned by this mount.
 */
export class WorldTaskQueue extends PriorityQueue {
  private wake: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  override scheduleJobRun() {
    if (this.closed || this.wake !== undefined) return;
    this.wake = setTimeout(() => {
      this.wake = undefined;
      if (!this.closed) this.tryRunJobs();
    }, 4);
  }

  dispose() {
    this.closed = true;
    if (this.wake !== undefined) clearTimeout(this.wake);
    this.wake = undefined;
    this.removeByFilter(() => true);
  }
}
