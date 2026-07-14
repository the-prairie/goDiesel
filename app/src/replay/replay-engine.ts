import type { QuestRoute } from "@/domain/routes";
import { CesiumReplayEngine } from "@/replay/cesium/cesium-replay-engine";
import type { ReplayPose } from "@/replay/replay-controller";

export type ReplayStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export interface ReplayEngineMountOptions {
  container: HTMLElement;
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
    __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => ReplayEngine;
  }
}

export function createReplayEngine() {
  return window.__GODIESEL_REPLAY_ENGINE_FACTORY__?.() ?? new CesiumReplayEngine();
}
