import { describe, expect, it } from "vitest";

import {
  APPROACH_M,
  QUEUED_SHOW_MS,
  SHOW_MS,
  initialOverlandMomentsState,
  momentPhaseOf,
  momentTimeScale,
  reduceOverlandMoments,
  type MomentAnchor,
  type OverlandMomentsEvent,
  type OverlandMomentsState,
} from "@/labs/overland/overland-moments-state";

const ANCHORS: MomentAnchor[] = [
  { id: "stairs", atDistanceM: 1000, hasMedia: true },
  { id: "ridge", atDistanceM: 1040, hasMedia: true },
  { id: "far", atDistanceM: 5000, hasMedia: false },
];

function run(events: OverlandMomentsEvent[], from: OverlandMomentsState = initialOverlandMomentsState(ANCHORS)) {
  return events.reduce(reduceOverlandMoments, from);
}
const at = (progressM: number, nowMs: number, playing = true): OverlandMomentsEvent => ({ type: "progressed", progressM, playing, nowMs });

describe("reduceOverlandMoments", () => {
  it("starts idle, with every anchor idle", () => {
    const state = initialOverlandMomentsState(ANCHORS);
    expect(state.phase).toBe("idle");
    expect(ANCHORS.map((anchor) => momentPhaseOf(state, anchor.id))).toEqual(["idle", "idle", "idle"]);
  });

  it("approaches a moment within reach ahead, which slows playback a little", () => {
    const state = run([at(1000 - APPROACH_M + 1, 0)]);
    expect(state).toMatchObject({ phase: "approaching", id: "stairs" });
    expect(momentPhaseOf(state, "stairs")).toBe("approaching");
    expect(momentTimeScale(state)).toBeLessThan(1);
    expect(momentTimeScale(state)).toBeGreaterThan(0);
  });

  it("shows a moment when the runner reaches it, slower still, then tucks it away after a while", () => {
    const showing = run([at(900, 0), at(1001, 100)]);
    expect(showing).toMatchObject({ phase: "showing", id: "stairs", shownAt: 100 });
    expect(momentTimeScale(showing)).toBeLessThan(momentTimeScale(run([at(900, 0)])));
    // ridge was passed too: it waits its turn.
    const passedBoth = run([at(900, 0), at(1050, 100)]);
    expect(passedBoth).toMatchObject({ phase: "showing", id: "stairs", queue: ["ridge"] });
    const next = run([at(1060, 100 + QUEUED_SHOW_MS)], passedBoth);
    expect(next).toMatchObject({ phase: "showing", id: "ridge", shownAt: 100 + QUEUED_SHOW_MS, queue: [] });
    expect(momentPhaseOf(next, "stairs")).toBe("dismissed");
    const after = run([at(1100, 100 + QUEUED_SHOW_MS + SHOW_MS)], next);
    expect(after.phase).toBe("idle");
    expect(momentTimeScale(after)).toBe(1);
  });

  it("does not show a moment while paused, nor count time on screen while paused", () => {
    expect(run([at(900, 0), at(1001, 100, false)]).phase).not.toBe("showing");
    const showing = run([at(900, 0), at(1001, 100)]);
    expect(run([at(1001, 100 + SHOW_MS * 2, false)], showing)).toMatchObject({ phase: "showing", id: "stairs" });
  });

  it("pauses for media only when the viewer opens it, and carries on when it is closed", () => {
    const showing = run([at(900, 0), at(1001, 100)]);
    const open = run([{ type: "mediaOpened", id: "stairs" }], showing);
    expect(open).toMatchObject({ phase: "mediaOpen", id: "stairs" });
    expect(momentTimeScale(open)).toBe(0);
    // Time does not tuck it away while it is open.
    expect(run([at(1001, 100 + SHOW_MS * 3)], open)).toMatchObject({ phase: "mediaOpen" });
    const closed = run([{ type: "mediaClosed", id: "stairs", nowMs: 9000 }], open);
    // The ridge, 39 m on, is the next moment approached.
    expect(closed).toMatchObject({ phase: "approaching", id: "ridge" });
    expect(momentPhaseOf(closed, "stairs")).toBe("dismissed");
  });

  it("can be dismissed early, and the next waiting moment follows", () => {
    const both = run([at(900, 0), at(1050, 100)]);
    const dismissed = run([{ type: "dismissRequested", id: "stairs", nowMs: 200 }], both);
    expect(dismissed).toMatchObject({ phase: "showing", id: "ridge", shownAt: 200 });
  });

  it("ignores events for a moment that is not the one on screen", () => {
    const showing = run([at(900, 0), at(1001, 100)]);
    expect(reduceOverlandMoments(showing, { type: "dismissRequested", id: "far", nowMs: 1 })).toBe(showing);
    expect(reduceOverlandMoments(showing, { type: "mediaOpened", id: "ridge" })).toBe(showing);
    expect(reduceOverlandMoments(showing, { type: "mediaClosed", id: "stairs", nowMs: 1 })).toBe(showing);
  });

  it("scrubbing forward past moments skips them quietly", () => {
    const state = run([{ type: "seeked", progressM: 3000 }, at(3010, 50)]);
    expect(state.phase).toBe("idle");
    expect(momentPhaseOf(state, "stairs")).toBe("dismissed");
    expect(momentPhaseOf(state, "ridge")).toBe("dismissed");
    expect(momentPhaseOf(state, "far")).toBe("idle");
  });

  it("scrubbing back before a moment brings it back, and puts away one that is now ahead", () => {
    const seen = run([at(900, 0), at(1001, 100), { type: "dismissRequested", id: "stairs", nowMs: 150 }]);
    expect(momentPhaseOf(seen, "stairs")).toBe("dismissed");
    const back = run([{ type: "seeked", progressM: 500 }], seen);
    expect(back.phase).toBe("idle");
    expect(momentPhaseOf(back, "stairs")).toBe("idle");
    expect(run([at(1001, 400)], back)).toMatchObject({ phase: "showing", id: "stairs" });
    const showingThenBack = run([at(900, 0), at(1001, 100), { type: "seeked", progressM: 200 }]);
    expect(showingThenBack.phase).toBe("idle");
  });

  it("a scrub that lands on a moment does not show it until the runner moves through it", () => {
    expect(run([{ type: "seeked", progressM: 1000 }]).phase).toBe("idle");
  });
});
