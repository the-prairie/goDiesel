import type { PreparedViewReport } from "./world-prepared-view";
import type { CloudBudgetReport } from "./world-cloud-budget";
import type { GoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";
import type { WorldEnvironment, WorldLayers } from "./world-model";
import type { WorldViewCoverage, WorldViewState } from "./world-view-health";
import type { TerrainFocusSample } from "./world-terrain-diagnostics";
import type { WorldLabelDiagnostics } from "./world-labels";
import { WorldFrameHistory, WORLD_HISTORY_MS } from "./world-frame-history";
export { WorldFrameHistory } from "./world-frame-history";

/** Read-only, instance-scoped diagnostics. Never include provider URLs or keys. */
export const WORLD_DIAGNOSTICS_EVENT = "godiesel:world-diagnostics";
export interface WorldPlaybackContext extends GoogleRouteNavigatorState {
  cameraSettling: boolean;
  settingsOpen: boolean;
  reducedMotion: boolean;
}
export interface WorldBuildIdentity {
  revision: string | null;
  source: "git" | "environment" | "unavailable";
  sourceState: "clean" | "modified" | "unknown";
  builtAt: string | null;
}
declare const __GODIESEL_BUILD__: WorldBuildIdentity;
export const WORLD_BUILD: WorldBuildIdentity = typeof __GODIESEL_BUILD__ === "undefined"
  ? { revision: null, source: "unavailable", sourceState: "unknown", builtAt: null }
  : __GODIESEL_BUILD__;

export interface WorldReportState {
  playback: WorldPlaybackContext | null;
  preparation?: PreparedViewReport;
  camera: {
    requestedMode: string | null; directedMode: string | null; owner: "following" | "free";
    displayedProgressM?: number | null;
    requestedRangeM: number | null; actualRangeM: number | null; fovDeg: number;
    nearM: number; farM: number; meshCorrectionM: number; clearanceState?: "measured" | "unknown";
    targetSurfaceErrorM?: number | null; targetCorrectionM?: number;
    sightline?: "clear" | "blocked" | "unknown";
    heightM?: number | null; groundHeightM?: number | null; clearanceM?: number | null;
  };
  layers: WorldLayers;
  quality: {
    requested: WorldEnvironment["quality"]; effective: WorldEnvironment["quality"];
    light: WorldEnvironment["light"]; clouds: number; labels: boolean; cloudsEnabled: boolean; cloudPassSubmissions?: number; cloudBudget?: CloudBudgetReport;
  };
  terrain: {
    renderedMeshes: number; visibleTiles: number; focusErrorM: number | null;
    progress: number; cachedBytes: number; errorTargetPx: number;
    focus: TerrainFocusSample & { ageMs: number | null; cameraChangedSinceSample: boolean };
    queues: { downloading: number; parsing: number; failed: number };
    view?: { state: WorldViewState; coverage: WorldViewCoverage; buffering?: boolean };
    streaming?: { pendingLimit: number; backpressured: boolean; discardedStaleParses: number; lookAhead: string; lookAheadProgressM: number | null; cameraSupport?: { active: boolean; radiusM: number; errorTargetM: number }; indexedSurfaceModels?: number };
  };
  visibleRoadLabels: number;
  labelActivity?: WorldLabelDiagnostics;
  contextLost: boolean;
}
export type WorldReportEvent = "mount" | "play" | "pause" | "seek" | "camera-mode" | "free-camera" | "recenter" | "zoom" | "speed" | "grounding" | "settings-open" | "settings-close" | "quality" | "environment" | "layers" | "hidden" | "visible" | "context-lost" | "failure" | "buffer-start" | "buffer-end" | "view-prepare" | "view-ready" | "view-blocked" | "view-commit";

/** All retained state is numeric/enumerated. No route geometry, resource names or payloads. */
export class WorldFlightRecorder {
  private readonly history = new WorldFrameHistory();
  private readonly events: { atMs: number; kind: WorldReportEvent; state?: WorldReportState; scrub?: { fromM: number; toM: number; minM: number; maxM: number; updates: number; endMs: number } }[] = [];
  private readonly timeline: { atMs: number; state: WorldReportState }[] = [];
  private readonly eventCounts: Partial<Record<WorldReportEvent, number>> = {};
  private droppedEvents = 0;
  private seekEvent: (typeof this.events)[number] | undefined;
  private lastTimeline = -Infinity;
  private visibilityAt = 0;
  private visibleMs = 0;
  private hiddenMs = 0;
  private endedAt: number | undefined;
  private renderSubmissions = 0;
  private firstTerrainDrawAt: number | null = null;
  constructor(private readonly startedAt: number, private visible: boolean) {
    this.mark("mount", startedAt);
  }
  time(now: number) { return Math.max(0, now - this.startedAt); }
  frame(now: number, context: WorldPlaybackContext | null, buffering = false) {
    if (this.endedAt !== undefined) return;
    // A following camera continually eases during normal playback. Do not label
    // the entire ride a transition merely because that moving target has not settled.
    const activity = !context ? "unknown" : buffering ? "transition" : context.playing ? "playing" : context.cameraSettling ? "transition" : "paused";
    this.history.record(this.time(now), this.visible, activity);
  }
  submitted(now: number, terrainMeshes: number) {
    if (this.endedAt !== undefined) return;
    this.renderSubmissions++;
    if (terrainMeshes > 0 && this.firstTerrainDrawAt === null) this.firstTerrainDrawAt = this.time(now);
  }
  mark(kind: WorldReportEvent, now: number, state?: WorldReportState) {
    if (this.endedAt !== undefined) return;
    this.eventCounts[kind] = (this.eventCounts[kind] ?? 0) + 1;
    const atMs = this.time(now), progress = state?.playback?.progressM;
    if (kind === "seek" && progress !== undefined) {
      const previous = this.seekEvent;
      if (previous?.scrub && atMs - previous.scrub.endMs < 250) {
        previous.scrub.toM = progress;
        previous.scrub.minM = Math.min(previous.scrub.minM, progress);
        previous.scrub.maxM = Math.max(previous.scrub.maxM, progress);
        previous.scrub.updates++; previous.scrub.endMs = atMs;
        previous.state = structuredClone(state);
        return;
      }
    } else if (kind !== "layers" && kind !== "quality") this.seekEvent = undefined;
    this.history.boundary();
    const event: (typeof this.events)[number] = { atMs, kind, ...(state ? { state: structuredClone(state) } : {}) };
    if (kind === "seek" && progress !== undefined) {
      event.scrub = { fromM: progress, toM: progress, minM: progress, maxM: progress, updates: 1, endMs: atMs };
      this.seekEvent = event;
    }
    this.events.push(event);
    if (this.events.length > 256) { this.events.shift(); this.droppedEvents++; }
  }
  sample(now: number, state: WorldReportState) {
    if (this.endedAt !== undefined) return;
    const time = this.time(now);
    if (time - this.lastTimeline < 1000) return;
    this.lastTimeline = time;
    this.timeline.push({ atMs: time, state: structuredClone(state) });
    this.prune(time);
  }
  private prune(time: number) {
    while (this.timeline.length && this.timeline[0].atMs < time - WORLD_HISTORY_MS) this.timeline.shift();
  }
  visibility(now: number, visible: boolean) {
    if (this.endedAt !== undefined || visible === this.visible) return;
    const time = this.time(now);
    if (this.visible) this.visibleMs += Math.max(0, time - this.visibilityAt);
    else this.hiddenMs += Math.max(0, time - this.visibilityAt);
    this.visibilityAt = time; this.visible = visible;
    // Visibility events reset the interval even when the browser suspends rAF entirely.
    this.history.suspend();
    this.mark(visible ? "visible" : "hidden", now);
  }
  stop(now: number) { if (this.endedAt === undefined) { this.endedAt = this.time(now); this.history.suspend(); } }
  snapshot(now: number) {
    const time = this.time(now), end = this.endedAt ?? time;
    this.prune(time);
    return {
      frames: this.history.snapshot(time),
      session: {
        scope: "current-cinematic-renderer-mount" as const,
        elapsedMs: end, ended: this.endedAt !== undefined,
        visibleMs: this.visibleMs + (this.visible ? Math.max(0, end - this.visibilityAt) : 0),
        hiddenMs: this.hiddenMs + (!this.visible ? Math.max(0, end - this.visibilityAt) : 0),
        firstTerrainDrawMs: this.firstTerrainDrawAt, renderSubmissions: this.renderSubmissions,
        frames: this.history.session(), eventCounts: { ...this.eventCounts },
      },
      timeline: structuredClone(this.timeline),
      events: { dropped: this.droppedEvents, entries: structuredClone(this.events) },
    };
  }
}
export interface WorldDiagnostics extends WorldReportState, ReturnType<WorldFlightRecorder["snapshot"]> {
  schema: "godiesel-world-report-v2";
  routeSlug: string;
  capturedAt: string;
  build: WorldBuildIdentity;
  device: { browser: string; graphics: string; softwareRenderer: boolean; width: number; height: number; pixelRatio: number };
  interpretation: {
    frames: "Callback intervals, not GPU-presented FPS. Hidden intervals are excluded; transitions are separate.";
    terrain: "Center-ray geometric error estimates detail, not route/label positional accuracy. Loading progress is not a quality score.";
  };
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
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    const target = document.querySelector("[data-world-terrain]");
    const report = target && readWorldDiagnostics(target);
    if (!report) return false;
    url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    link = document.createElement("a");
    link.href = url; link.download = "godiesel-playback-report.json";
    document.body.append(link); link.click();
    return true;
  } catch { return false; }
  finally {
    link?.remove();
    if (url) { const savedUrl = url; window.setTimeout(() => URL.revokeObjectURL(savedUrl), 1000); }
  }
}
