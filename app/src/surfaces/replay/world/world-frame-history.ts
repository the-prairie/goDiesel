/** Animation-frame callback timing, not GPU presentation timing or a device benchmark. */
export const WORLD_HISTORY_MS = 60_000;
export const FRAME_ACTIVITIES = ["playing", "paused", "transition", "unknown"] as const;
export type FrameActivity = typeof FRAME_ACTIVITIES[number];
export interface FrameTotals {
  samples: number;
  intervalTotalMs: number;
  maxMs: number | null;
  above50Ms: number;
  above100Ms: number;
  above250Ms: number;
  above1000Ms: number;
}
export const emptyFrameTotals = (): FrameTotals => ({
  samples: 0, intervalTotalMs: 0, maxMs: null,
  above50Ms: 0, above100Ms: 0, above250Ms: 0, above1000Ms: 0,
});
const rounded = (value: number) => Math.round(value * 100) / 100;
function accumulate(total: FrameTotals, ms: number) {
  total.samples++;
  total.intervalTotalMs += ms;
  total.maxMs = Math.max(total.maxMs ?? 0, ms);
  if (ms > 50) total.above50Ms++;
  if (ms > 100) total.above100Ms++;
  if (ms > 250) total.above250Ms++;
  if (ms > 1000) total.above1000Ms++;
}
function totalsCopy(total: FrameTotals): FrameTotals {
  return { ...total, intervalTotalMs: rounded(total.intervalTotalMs), maxMs: total.maxMs === null ? null : rounded(total.maxMs) };
}
function summarize(values: number[]) {
  values.sort((a, b) => a - b);
  const total = emptyFrameTotals();
  for (const value of values) accumulate(total, value);
  const percentile = (p: number) => values.length ? rounded(values[Math.max(0, Math.ceil(p * values.length) - 1)]) : null;
  return { ...totalsCopy(total), medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
}

/**
 * Time-evicted ring: 60 seconds at 60/120/240/360 Hz, not 240 frames.
 * Typed storage bounds memory (~1.1 MiB). The emergency cap supports >1,000 Hz;
 * any overflow is explicit in the report, never silently described as a full minute.
 * Session counters and worst stalls are independent of recent-history eviction.
 * Sorting/bucketing happens only when exporting, never in the render loop.
 */
export class WorldFrameHistory {
  private readonly times: Float64Array;
  private readonly intervals: Float64Array;
  private readonly activities: Uint8Array;
  private head = 0;
  private count = 0;
  private previous: number | undefined;
  private previousActivity: FrameActivity = "unknown";
  private boundaryPending = false;
  private latest = 0;
  private lastCapacityDrop = -Infinity;
  private capacityDrops = 0;
  private invalidSamples = 0;
  private readonly total = emptyFrameTotals();
  private readonly activityTotals = FRAME_ACTIVITIES.map(() => emptyFrameTotals());
  private readonly worst: { endMs: number; durationMs: number; activity: FrameActivity }[] = [];

  constructor(private readonly windowMs = WORLD_HISTORY_MS, private readonly capacity = 65_536) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(capacity) || capacity < 1) throw new Error("Positive history window and capacity required");
    this.times = new Float64Array(capacity);
    this.intervals = new Float64Array(capacity);
    this.activities = new Uint8Array(capacity);
  }
  boundary() { this.boundaryPending = true; }
  suspend() { this.previous = undefined; this.boundaryPending = false; }
  private prune(now: number) {
    while (this.count && this.times[this.head] <= now - this.windowMs) {
      this.head = (this.head + 1) % this.capacity; this.count--;
    }
  }
  record(now: number, visible: boolean, activity: FrameActivity = "unknown") {
    if (!Number.isFinite(now) || now < this.latest) { this.invalidSamples++; return; }
    this.latest = now;
    this.prune(now);
    if (!visible) { this.suspend(); return; }
    if (this.previous !== undefined && now > this.previous) {
      const ms = now - this.previous;
      const phase = this.boundaryPending || activity !== this.previousActivity ? "transition" : activity;
      const phaseIndex = FRAME_ACTIVITIES.indexOf(phase);
      accumulate(this.total, ms); accumulate(this.activityTotals[phaseIndex], ms);
      if (this.count === this.capacity) {
        this.lastCapacityDrop = this.times[this.head]; this.capacityDrops++;
        this.head = (this.head + 1) % this.capacity; this.count--;
      }
      const index = (this.head + this.count++) % this.capacity;
      this.times[index] = now; this.intervals[index] = ms; this.activities[index] = phaseIndex;
      // Preserve up to 12 worst stalls for the entire mount, even after they age out.
      if (ms > 50 && (this.worst.length < 12 || ms > this.worst[this.worst.length - 1].durationMs)) {
        this.worst.push({ endMs: now, durationMs: ms, activity: phase });
        this.worst.sort((a, b) => b.durationMs - a.durationMs); this.worst.length = Math.min(12, this.worst.length);
      }
      this.boundaryPending = false;
    }
    // Events before the first callback do not span a measured interval.
    if (this.previous === undefined) this.boundaryPending = false;
    this.previous = now; this.previousActivity = activity;
  }
  snapshot(now = this.latest) {
    now = Math.max(this.latest, Number.isFinite(now) ? now : this.latest);
    this.prune(now);
    const values: number[] = [];
    const phases = FRAME_ACTIVITIES.map(() => [] as number[]);
    const buckets = new Map<number, number[]>();
    let firstStart = now, lastEnd = now;
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % this.capacity;
      const end = this.times[index], ms = this.intervals[index];
      if (i === 0) firstStart = Math.max(end - ms, now - this.windowMs);
      lastEnd = end;
      values.push(ms); phases[this.activities[index]].push(ms);
      const second = Math.floor(end / 1000);
      if (!buckets.has(second)) buckets.set(second, []);
      buckets.get(second)!.push(ms);
    }
    return {
      measurement: "animation-frame-callback-intervals" as const,
      percentileMethod: "nearest-rank" as const,
      requestedWindowMs: this.windowMs,
      windowMs: this.count ? rounded(lastEnd - firstStart) : 0,
      fromMs: this.count ? rounded(firstStart) : null,
      toMs: this.count ? rounded(lastEnd) : null,
      lastSampleAgeMs: this.count ? rounded(now - lastEnd) : null,
      // Full durations of intervals ENDING in the window are counted. An interval
      // crossing the cutoff can make intervalTotalMs exceed the wall-clock span.
      ...summarize(values),
      byActivity: Object.fromEntries(FRAME_ACTIVITIES.map((phase, i) => [phase, summarize(phases[i])])),
      seconds: [...buckets].map(([second, intervals]) => ({ fromMs: second * 1000, toMs: (second + 1) * 1000, ...summarize(intervals) })),
      retention: { capacity: this.capacity, truncated: this.lastCapacityDrop > now - this.windowMs, capacityDrops: this.capacityDrops },
    };
  }
  session() {
    return {
      ...totalsCopy(this.total), invalidSamples: this.invalidSamples,
      byActivity: Object.fromEntries(FRAME_ACTIVITIES.map((phase, i) => [phase, totalsCopy(this.activityTotals[i])])),
      worstIntervals: this.worst.map((entry) => ({ ...entry, endMs: rounded(entry.endMs), durationMs: rounded(entry.durationMs) })),
    };
  }
}
