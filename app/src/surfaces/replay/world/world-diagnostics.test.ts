import { describe, expect, it } from "vitest";
import { bindWorldDiagnostics, readWorldDiagnostics, WorldFlightRecorder, type WorldDiagnostics, type WorldPlaybackContext, type WorldReportState } from "./world-diagnostics";
import { DEFAULT_WORLD_ENVIRONMENT } from "./world-model";
import { emptyTerrainFocus } from "./world-terrain-diagnostics";
import { initialGoogleRouteNavigatorState } from "../playback/route-navigator-controller";

const playback = (playing: boolean): WorldPlaybackContext => ({ ...initialGoogleRouteNavigatorState(), playing, cameraSettling: false, settingsOpen: false, reducedMotion: false });
const state = (): WorldReportState => ({
  playback: playback(true),
  camera: { owner: "following", requestedMode: "chase", directedMode: "chase", requestedRangeM: 1000, actualRangeM: 1050, fovDeg: 54, nearM: 10, farM: 20000, meshCorrectionM: 0 },
  layers: { terrain: "ready", route: "ready", atmosphere: "ready", labels: "ready" },
  quality: { ...DEFAULT_WORLD_ENVIRONMENT, requested: "balanced", effective: "balanced", cloudsEnabled: false },
  terrain: { renderedMeshes: 1, visibleTiles: 1, focusErrorM: null, progress: 0.5, cachedBytes: 0, errorTargetPx: 10, focus: { ...emptyTerrainFocus(), ageMs: null, cameraChangedSinceSample: false }, queues: { downloading: 0, parsing: 0, failed: 0 } },
  contextLost: false, visibleRoadLabels: 1,
});

describe("session diagnostics", () => {
  it("records wall time separately from frame history and hidden time", () => {
    const recorder = new WorldFlightRecorder(100, true);
    recorder.frame(100, playback(true)); recorder.frame(116, playback(true));
    recorder.visibility(200, false); recorder.visibility(10_200, true);
    recorder.frame(10_201, playback(false)); recorder.frame(10_217, playback(false));
    const report = recorder.snapshot(10_300);
    expect(report.session).toMatchObject({ elapsedMs: 10200, visibleMs: 200, hiddenMs: 10000 });
    expect(report.session.frames).toMatchObject({ samples: 2, intervalTotalMs: 32, above50Ms: 0 });
    expect(report.events.entries.map(event => event.kind)).toEqual(["mount", "hidden", "visible"]);
  });
  it("counts a continuously easing Chase camera as active playback", () => {
    const recorder = new WorldFlightRecorder(0, true);
    const moving = { ...playback(true), cameraSettling: true };
    recorder.frame(0, moving); recorder.frame(10, moving); recorder.frame(20, moving);
    expect(recorder.snapshot(20).frames.byActivity.playing.samples).toBe(2);
    recorder.frame(30, { ...moving, playing: false });
    expect(recorder.snapshot(30).frames.byActivity.transition.samples).toBe(1);
  });
  it("retains bounded context and event history, with complete event totals", () => {
    const recorder = new WorldFlightRecorder(0, true);
    for (let i = 0; i < 3600; i++) { recorder.sample(i * 1000, state()); recorder.mark("seek", i * 1000, state()); }
    const report = recorder.snapshot(3600_000);
    expect(report.timeline).toHaveLength(60);
    expect(report.events.entries).toHaveLength(256);
    expect(report.events.dropped).toBe(3345);
    expect(report.session.eventCounts.seek).toBe(3600);
    report.timeline[0].state.camera.actualRangeM = 0;
    expect(recorder.snapshot(3600_000).timeline[0].state.camera.actualRangeM).toBe(1050);
    expect(recorder.snapshot(3700_000).timeline).toHaveLength(0);
  });
  it("counts submissions independently of callbacks, and freezes ended-session totals", () => {
    const recorder = new WorldFlightRecorder(100, true);
    recorder.frame(100, playback(false)); recorder.frame(120, playback(false));
    recorder.submitted(140, 0); recorder.submitted(160, 5); recorder.stop(180);
    recorder.frame(200, playback(true)); recorder.submitted(200, 10); recorder.mark("play", 200);
    expect(recorder.snapshot(1000).session).toMatchObject({ elapsedMs: 80, visibleMs: 80, ended: true, renderSubmissions: 2, firstTerrainDrawMs: 60, frames: { samples: 1 } });
  });
  it("does not mix unrelated or disposed renderer instances", () => {
    const one = new EventTarget(), two = new EventTarget();
    const report = { schema: "godiesel-world-report-v2" } as WorldDiagnostics;
    const dispose = bindWorldDiagnostics(one, () => report);
    expect(readWorldDiagnostics(one)).toEqual(report); expect(readWorldDiagnostics(two)).toBeNull();
    dispose(); dispose(); expect(readWorldDiagnostics(one)).toBeNull();
  });
});
