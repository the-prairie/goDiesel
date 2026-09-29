import { describe, expect, it } from "vitest";

import { initialReplayState, seekReplay, toggleReplay } from "@/surfaces/replay/playback/replay-controller";
import { holdReplay, releaseReplayHold } from "@/surfaces/replay/playback/replay-hold";

const TOTAL = 15_000;

describe("replay hold", () => {
  it("pauses and records where and whether the route was playing", () => {
    const playing = toggleReplay(seekReplay(initialReplayState(), 4_200, TOTAL));
    const { control, hold } = holdReplay(playing, "footage");
    expect(control.playing).toBe(false);
    expect(control.progressM).toBe(4_200);
    expect(hold.reason).toBe("footage");
    expect(hold.control).toMatchObject({ progressM: 4_200, playing: true });
  });

  it("returns to the exact held distance even after the route was moved", () => {
    const { control, hold } = holdReplay(toggleReplay(seekReplay(initialReplayState(), 4_200, TOTAL)), "film");
    seekReplay(control, 12_000, TOTAL);
    const back = releaseReplayHold(hold, TOTAL);
    expect(back.progressM).toBe(4_200);
    expect(back.playing).toBe(true);
  });

  it("keeps a paused route paused on return", () => {
    const { control, hold } = holdReplay(seekReplay(initialReplayState(), 900, TOTAL), "scene");
    expect(control.playing).toBe(false);
    expect(releaseReplayHold(hold, TOTAL).playing).toBe(false);
  });

  it("restores camera choices made before the hold", () => {
    const start = { ...seekReplay(initialReplayState(), 900, TOTAL), following: false, speed: 4 };
    const { hold } = holdReplay(start, "inspect");
    const back = releaseReplayHold(hold, TOTAL);
    expect(back.following).toBe(false);
    expect(back.speed).toBe(4);
  });
});
