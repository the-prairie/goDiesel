import {
  seekReplay,
  type ReplayControlState,
} from "@/surfaces/replay/playback/replay-controller";

/**
 * Where the reader was when something interrupted the route: footage, a
 * captured scene, the film, or inspecting another chapter. Releasing it
 * returns to exactly that distance, playing state and camera, whatever moved
 * in between (the film's route pass moves all three).
 */
export type ReplayHoldReason = "footage" | "scene" | "film" | "inspect";

/** What any Replay stage's hold exposes to the adventure layer. */
export interface AdventureHold {
  reason: ReplayHoldReason;
  progressM: number;
  playing: boolean;
}

export interface ReplayHold extends AdventureHold {
  control: ReplayControlState;
}

export function holdReplay(control: ReplayControlState, reason: ReplayHoldReason) {
  return {
    hold: { control, reason, progressM: control.progressM, playing: control.playing } satisfies ReplayHold,
    control: { ...control, playing: false },
  };
}

export function releaseReplayHold(hold: ReplayHold, totalDistanceM: number): ReplayControlState {
  const returned = seekReplay({ ...hold.control, playing: false }, hold.control.progressM, totalDistanceM);
  return { ...returned, playing: hold.control.playing && returned.progressM < totalDistanceM };
}
