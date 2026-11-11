import type { QuestRoute } from "@/domain/route";
import { MapLibreAtlasReplayEngine } from "@/surfaces/replay/renderers/maplibre-replay-engine";
import { CesiumReplayEngine } from "@/surfaces/replay/renderers/cesium-replay-engine";
import type { ReplayPose } from "@/surfaces/replay/playback/replay-controller";

export type ReplayStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "partial"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export type ReplayEngineMode = "earth" | "atlas";

export interface ReplayEngineMountOptions {
  container: HTMLElement;
  route: QuestRoute;
  onStatus: (status: ReplayStatus) => void;
  /**
   * The person changed the camera distance on the renderer itself (its own
   * zoom control, a pinch or the wheel). The session owns the range; it
   * records this so the next follow pose keeps the person's choice.
   */
  onCameraRangeChosen?: (cameraRangeM: number) => void;
}

export interface ReplayEngine {
  mount(options: ReplayEngineMountOptions): Promise<void>;
  setPose(pose: ReplayPose): void;
  destroy(): void;
}

declare global {
  interface Window {
    __GODIESEL_REPLAY_ENGINE_FACTORY__?: (
      mode: ReplayEngineMode,
    ) => ReplayEngine | undefined;
  }
}

export function createReplayEngine(mode: ReplayEngineMode) {
  return (
    window.__GODIESEL_REPLAY_ENGINE_FACTORY__?.(mode) ??
    (mode === "earth" ? new CesiumReplayEngine() : new MapLibreAtlasReplayEngine())
  );
}
