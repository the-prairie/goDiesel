import { PriorityQueue } from "3d-tiles-renderer/core";

/**
 * Decoding must not wait for a GPU frame. In the live world a slow frame left
 * hundreds of already-downloaded tiles behind an animation-frame-scheduled
 * parse queue. A bounded task queue lets the visible detail catch up without
 * changing the tile priority, imagery, or any global library queue.
 */
export class WorldParseQueue extends PriorityQueue {
  private pending?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly visible = () => typeof document === "undefined" || !document.hidden) {
    super();
    this.maxJobs = 4;
  }

  override scheduleJobRun() {
    if (this.disposed || this.pending !== undefined) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      if (this.disposed) return;
      if (!this.visible()) {
        this.scheduleJobRun();
        return;
      }
      this.tryRunJobs();
    }, this.visible() ? 0 : 250);
  }

  dispose() {
    this.disposed = true;
    this.autoUpdate = false;
    if (this.pending !== undefined) clearTimeout(this.pending);
    this.pending = undefined;
    this.removeByFilter(() => true);
  }
}
