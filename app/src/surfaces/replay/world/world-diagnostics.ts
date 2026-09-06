/** Read-only, instance-scoped diagnostics. Never include provider URLs or keys. */
export const WORLD_DIAGNOSTICS_EVENT = "godiesel:world-diagnostics";
export interface WorldFrameSample {
  samples: number;
  medianMs: number | null;
  p95Ms: number | null;
  above50Ms: number;
  windowMs: number;
}

/** Bounded history of visible rendered frame intervals, not a device benchmark. */
export class WorldFrameHistory {
  private values: number[] = [];
  private cursor = 0;
  private previous: number | undefined;
  constructor(private readonly capacity = 240) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Positive frame capacity required");
  }
  record(now: number, visible: boolean) {
    if (!visible || !Number.isFinite(now)) { this.previous = undefined; return; }
    if (this.previous !== undefined && now > this.previous) {
      this.values[this.cursor] = now - this.previous;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    this.previous = now;
  }
  snapshot(): WorldFrameSample {
    const sorted = [...this.values].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      samples: sorted.length,
      medianMs: sorted.length ? round(sorted[Math.floor(sorted.length / 2)]) : null,
      p95Ms: sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]) : null,
      above50Ms: sorted.filter((value) => value > 50).length,
      windowMs: round(sorted.reduce((sum, value) => sum + value, 0)),
    };
  }
}

export interface WorldDiagnostics {
  schema: "godiesel-world-report-v1";
  routeSlug: string;
  capturedAt: string;
  device: { browser: string; graphics: string; softwareRenderer: boolean; width: number; height: number; pixelRatio: number };
  layers: { terrain: string; atmosphere: string; labels: string; route: string };
  quality: { requested: string; effective: string; light: string; clouds: number; labels: boolean };
  terrain: { renderedMeshes: number; visibleTiles: number; focusErrorM: number | null; progress: number; cachedBytes: number };
  visibleRoadLabels: number;
  frames: WorldFrameSample;
  contextLost: boolean;
}
interface ReportRequest { report: WorldDiagnostics | null; }

export function bindWorldDiagnostics(target: EventTarget, read: () => WorldDiagnostics) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ReportRequest>).detail;
    if (detail && typeof detail === "object") detail.report = read();
  };
  target.addEventListener(WORLD_DIAGNOSTICS_EVENT, listener);
  return () => target.removeEventListener(WORLD_DIAGNOSTICS_EVENT, listener);
}
export function readWorldDiagnostics(target: EventTarget): WorldDiagnostics | null {
  const detail: ReportRequest = { report: null };
  target.dispatchEvent(new CustomEvent(WORLD_DIAGNOSTICS_EVENT, { detail }));
  return detail.report;
}

export function saveWorldDiagnostics(): boolean {
  const target = document.querySelector("[data-world-terrain]");
  const report = target && readWorldDiagnostics(target);
  if (!report) return false;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "godiesel-playback-report.json";
  document.body.append(link);
  link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
