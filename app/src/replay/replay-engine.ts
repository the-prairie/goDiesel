import type { QuestRoute } from "@/domain/routes";
import { MapLibreAtlasReplayEngine } from "@/replay/atlas/maplibre-atlas-replay-engine";
import { CesiumReplayEngine } from "@/replay/cesium/cesium-replay-engine";
import type { ReplayPose } from "@/replay/replay-controller";

export type ReplayStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "partial"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export type ReplayEngineMode = "earth" | "atlas";

export interface ReplayEngineMountOptions {
  container: HTMLElement;
  avatarElement: HTMLElement;
  route: QuestRoute;
  onStatus: (status: ReplayStatus) => void;
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
