export type ReplayPerformanceState = "idle" | "sampling" | "complete";

export interface ReplayPerformanceReport {
  droppedFrameRatio: number;
  durationMs: number;
  frameCount: number;
  longestFrameMs: number;
  longestLongTaskMs: number;
  longTaskCount: number;
  p95FrameMs: number;
  state: ReplayPerformanceState;
}

interface ReplayPerformanceMonitorOptions {
  frameBudgetMs?: number;
  windowMs?: number;
}

export class ReplayPerformanceMonitor {
  private readonly frameBudgetMs: number;
  private readonly windowMs: number;
  private activeDurationMs = 0;
  private frameDurationsMs: number[] = [];
  private lastFrameAt?: number;
  private longestLongTaskMs = 0;
  private longTaskCount = 0;
  private state: ReplayPerformanceState = "idle";
  private completedReport?: ReplayPerformanceReport;

  constructor({
    frameBudgetMs = 34,
    windowMs = 30_000,
  }: ReplayPerformanceMonitorOptions = {}) {
    this.frameBudgetMs = frameBudgetMs;
    this.windowMs = windowMs;
  }

  sampleFrame(timestampMs: number, active: boolean) {
    if (this.state === "complete") return this.state;
    if (!active) {
      this.lastFrameAt = undefined;
      return this.state;
    }
    if (this.state === "idle") this.state = "sampling";
    if (this.lastFrameAt === undefined) {
      this.lastFrameAt = timestampMs;
      return this.state;
    }

    const durationMs = Math.max(0, timestampMs - this.lastFrameAt);
    this.lastFrameAt = timestampMs;
    this.activeDurationMs += durationMs;
    this.frameDurationsMs.push(durationMs);
    if (this.activeDurationMs >= this.windowMs) {
      this.state = "complete";
      this.completedReport = this.calculateReport();
    }
    return this.state;
  }

  recordLongTask(durationMs: number) {
    if (this.state !== "sampling") return;
    this.longTaskCount += 1;
    this.longestLongTaskMs = Math.max(this.longestLongTaskMs, durationMs);
  }

  suspend() {
    this.lastFrameAt = undefined;
  }

  report(): ReplayPerformanceReport {
    return this.completedReport ?? this.calculateReport();
  }

  private calculateReport(): ReplayPerformanceReport {
    const sorted = [...this.frameDurationsMs].sort((a, b) => a - b);
    const frameCount = sorted.length;
    const p95Index = Math.min(
      Math.max(0, frameCount - 1),
      Math.floor(frameCount * 0.95),
    );
    const droppedFrames = sorted.filter(
      (durationMs) => durationMs > this.frameBudgetMs,
    ).length;
    return {
      droppedFrameRatio: frameCount === 0 ? 0 : droppedFrames / frameCount,
      durationMs: this.activeDurationMs,
      frameCount,
      longestFrameMs: sorted.at(-1) ?? 0,
      longestLongTaskMs: this.longestLongTaskMs,
      longTaskCount: this.longTaskCount,
      p95FrameMs: sorted[p95Index] ?? 0,
      state: this.state,
    };
  }
}
