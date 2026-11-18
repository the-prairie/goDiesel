import { describe, expect, it } from "vitest";

import { initialRidgeGesture, reduceRidgeGesture, type RidgeGestureEvent, type RidgeGestureState } from "@/labs/sketch/sketch-ridge-gesture";

const run = (events: RidgeGestureEvent[], state: RidgeGestureState = initialRidgeGesture()) => {
  const effects: unknown[] = [];
  for (const event of events) {
    const next = reduceRidgeGesture(state, event);
    state = next.state;
    if (next.effect) effects.push(next.effect);
  }
  return { state, effects };
};

describe("the ridge's gestures", () => {
  it("plays or pauses on a tap of the marker", () => {
    const { state, effects } = run([{ type: "down", pointerId: 1, x: 200, onMarker: true }, { type: "up", pointerId: 1 }]);
    expect(effects).toEqual([{ type: "toggle" }]);
    expect(state.phase).toBe("idle");
  });

  it("takes her where you touch the ridge, then scrubs as you drag", () => {
    const { effects } = run([
      { type: "down", pointerId: 1, x: 120, onMarker: false },
      { type: "move", pointerId: 1, x: 130 },
      { type: "move", pointerId: 1, x: 150 },
      { type: "up", pointerId: 1 },
    ]);
    expect(effects).toEqual([{ type: "seekTo", x: 120 }, { type: "scrub", dx: 10 }, { type: "scrub", dx: 20 }]);
  });

  it("drags the marker without playing or pausing, once a thumb has moved past its slop", () => {
    const { effects } = run([
      { type: "down", pointerId: 1, x: 200, onMarker: true },
      { type: "move", pointerId: 1, x: 203 },
      { type: "move", pointerId: 1, x: 212 },
      { type: "up", pointerId: 1 },
    ]);
    expect(effects).toEqual([{ type: "scrub", dx: 12 }]);
  });

  it("zooms in on a still hold and out on release, without playing or pausing", () => {
    const { effects } = run([
      { type: "down", pointerId: 1, x: 200, onMarker: true },
      { type: "holdElapsed", pointerId: 1 },
      { type: "move", pointerId: 1, x: 230 },
      { type: "up", pointerId: 1 },
    ]);
    expect(effects).toEqual([{ type: "zoom", on: true }, { type: "scrub", dx: 30 }, { type: "zoom", on: false }]);
  });

  it("does not zoom once the drag has begun", () => {
    const { effects } = run([
      { type: "down", pointerId: 1, x: 100, onMarker: false },
      { type: "move", pointerId: 1, x: 140 },
      { type: "holdElapsed", pointerId: 1 },
    ]);
    expect(effects).not.toContainEqual({ type: "zoom", on: true });
  });

  it("settles back if the system takes the touch, and ignores a second finger", () => {
    const zoomed = run([{ type: "down", pointerId: 1, x: 200, onMarker: false }, { type: "holdElapsed", pointerId: 1 }]);
    const cancelled = run([{ type: "down", pointerId: 2, x: 50, onMarker: false }, { type: "cancel", pointerId: 1 }], zoomed.state);
    expect(cancelled.effects).toEqual([{ type: "zoom", on: false }]);
    expect(cancelled.state.phase).toBe("idle");
  });
});
