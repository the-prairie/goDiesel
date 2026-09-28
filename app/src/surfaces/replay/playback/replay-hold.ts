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
export interface ReplayHold {
  control: ReplayControlState;
  reason: "footage" | "scene" | "film" | "inspect";
}

export function holdReplay(control: ReplayControlState, reason: ReplayHold["reason"]) {
  return {
    hold: { control, reason } satisfies ReplayHold,
    control: { ...control, playing: false },
  };
}

export function releaseReplayHold(hold: ReplayHold, totalDistanceM: number): ReplayControlState {
  const returned = seekReplay({ ...hold.control, playing: false }, hold.control.progressM, totalDistanceM);
  return { ...returned, playing: hold.control.playing && returned.progressM < totalDistanceM };
}
