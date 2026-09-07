/** One owner for pending view intent. A completed old request can never move the camera. */
export type ReplayViewPhase = "selecting" | "preparing" | "blocked";
export type ReplayPreparationReason = "surface" | "coverage" | "sightline" | "materials" | "timeout" | "unavailable";
export interface ReplayPreparedView {
  ready: boolean;
  requestId: number;
  reason?: ReplayPreparationReason;
  transition: "cut" | "flight";
  preparationMs: number;
}
export interface ReplayViewRequestOptions {
  requestId: number;
  signal: AbortSignal;
  automatic: boolean;
}
export interface PendingReplayView<T> {
  requestId: number;
  destination: T;
  phase: ReplayViewPhase;
  reason?: ReplayPreparationReason;
}
export class ReplayViewHandoff<T> {
  private generation = 0;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private run?: () => void;
  private value: PendingReplayView<T> | null = null;
  constructor(private readonly changed: (value: PendingReplayView<T> | null) => void) {}
  get pending() { return this.value; }
  request(destination: T,
    prepare: (options: ReplayViewRequestOptions) => Promise<ReplayPreparedView>,
    commit: (destination: T, result: ReplayPreparedView) => boolean,
    automatic = false, delayMs = 90,
  ) {
    this.cancel(false);
    const requestId = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    this.value = { requestId, destination, phase: "selecting" }; this.changed(this.value);
    this.run = () => {
      this.run = undefined; this.timer = undefined;
      if (abort.signal.aborted || requestId !== this.generation) return;
      this.value = { requestId, destination, phase: "preparing" }; this.changed(this.value);
      void Promise.resolve().then(() => prepare({ requestId, signal: abort.signal, automatic })).then(result => {
        if (abort.signal.aborted || requestId !== this.generation) return;
        if (result.requestId !== requestId) throw new Error("Mismatched prepared view");
        if (result.ready && commit(destination, result)) {
          this.value = null; this.abort = undefined; this.changed(null);
        } else {
          this.value = { requestId, destination, phase: "blocked", reason: result.reason ?? "unavailable" };
          this.changed(this.value);
        }
      }).catch(() => {
        if (abort.signal.aborted || requestId !== this.generation) return;
        this.value = { requestId, destination, phase: "blocked", reason: "unavailable" };
        this.changed(this.value);
      });
    };
    this.timer = setTimeout(this.run, Math.max(0, delayMs));
  }
  /** Pointer/key release need not wait for the scrub debounce. */
  flush() { if (this.timer !== undefined) clearTimeout(this.timer); this.run?.(); }
  cancel(notify = true) {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined; this.run = undefined; this.value = null;
    if (notify) this.changed(null);
  }
}
