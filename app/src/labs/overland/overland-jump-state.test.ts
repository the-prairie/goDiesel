import { describe, expect, it } from "vitest";

import {
  LIVE_PIXEL_LEVELS,
  WIPE_STEPS,
  initialOverlandJumpState,
  jumpPresentation,
  reduceOverlandJump,
  surfaceCovered,
  townCover,
  type OverlandJumpEvent,
  type OverlandJumpState,
} from "@/labs/overland/overland-jump-state";

const READY = { state: "ready", message: "ready" } as const;
const LOADING = { state: "loading", message: "loading" } as const;
const UNAVAILABLE = { state: "unavailable", message: "Google 3D is unavailable." } as const;

function run(events: OverlandJumpEvent[], from: OverlandJumpState = initialOverlandJumpState()) {
  return events.reduce(reduceOverlandJump, from);
}

function requested(options: { reducedMotion?: boolean; transition?: "wipe" | "live" | "town" } = {}) {
  return run([{ type: "jumpRequested", slug: "kyoto", reducedMotion: options.reducedMotion ?? false, transition: options.transition ?? "wipe" }]);
}

const jumpIdOf = (state: OverlandJumpState) => ("jumpId" in state ? state.jumpId : -1);

describe("reduceOverlandJump", () => {
  it("1. a jump request from browsing starts a dive with a new jump id", () => {
    const first = requested();
    expect(first).toMatchObject({ phase: "diving", slug: "kyoto", scene: "loading" });
    const again = run(
      [{ type: "cancelRequested" }, { type: "jumpRequested", slug: "kyoto", reducedMotion: false, transition: "wipe" }],
      first,
    );
    expect(jumpIdOf(again)).toBeGreaterThan(jumpIdOf(first));
  });

  it("2. the dive always plays out; then the scene resolves, or the jump holds until it is ready", () => {
    const diving = requested();
    const jumpId = jumpIdOf(diving);
    const readyEarly = run([{ type: "sceneStatusReceived", jumpId, status: READY }], diving);
    expect(readyEarly).toMatchObject({ phase: "diving", scene: "ready" });
    expect(run([{ type: "diveFinished", jumpId }], readyEarly)).toMatchObject({ phase: "resolving", step: 0 });

    const holding = run([{ type: "diveFinished", jumpId }], diving);
    expect(holding).toMatchObject({ phase: "holding" });
    expect(run([{ type: "sceneStatusReceived", jumpId, status: LOADING }], holding)).toMatchObject({ phase: "holding" });
    expect(run([{ type: "sceneStatusReceived", jumpId, status: READY }], holding)).toMatchObject({ phase: "resolving", step: 0 });
  });

  it("3. each elapsed step clears more of the cover until the realm; a skip goes straight there", () => {
    const resolving = run([{ type: "diveFinished", jumpId: 1 }, { type: "sceneStatusReceived", jumpId: 1, status: READY }], requested());
    const coverages: number[] = [];
    let state = resolving;
    while (state.phase === "resolving") {
      coverages.push(jumpPresentation(state).coverCoverage);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(coverages).toHaveLength(WIPE_STEPS);
    expect(coverages).toEqual([...coverages].sort((a, b) => b - a));
    expect(state).toMatchObject({ phase: "realm" });
    expect(jumpPresentation(state)).toMatchObject({ coverCoverage: 0, liveMap: true, pixelLevel: 1 });

    expect(run([{ type: "skipRequested" }], resolving)).toMatchObject({ phase: "realm" });
  });

  it("3b. the live comparison steps the map's own pixel level instead of a cover", () => {
    const live = requested({ transition: "live" });
    let state = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "diveFinished", jumpId: 1 }], live);
    const levels: number[] = [];
    while (state.phase === "resolving") {
      levels.push(jumpPresentation(state).pixelLevel);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(levels).toEqual(LIVE_PIXEL_LEVELS.slice(0, -1));
    expect(jumpPresentation(state).pixelLevel).toBe(1);
  });

  it("4. with reduced motion there is no dive and no steps, in or out", () => {
    const reduced = requested({ reducedMotion: true });
    expect(reduced).toMatchObject({ phase: "holding" });
    const realm = run([{ type: "sceneStatusReceived", jumpId: jumpIdOf(reduced), status: READY }], reduced);
    expect(realm).toMatchObject({ phase: "realm" });
    // Leaving is one crossfade of the whole scene: nothing steps back.
    const leaving = run([{ type: "leaveRequested" }], realm);
    expect(leaving).toMatchObject({ phase: "surfacing" });
    expect(jumpPresentation(leaving)).toMatchObject({ liveMap: true, pixelLevel: 1 });
    expect(surfaceCovered(leaving)).toBe(true);
    expect(run([{ type: "surfaceFinished", jumpId: jumpIdOf(reduced) }], leaving)).toMatchObject({ phase: "browsing", slug: "kyoto" });
  });

  it("5. an unavailable scene in any phase leads to the fallback and keeps the key-rejection reason", () => {
    const diving = requested();
    const unavailable = { type: "sceneStatusReceived", jumpId: 1, status: UNAVAILABLE, reason: "authentication" } as const;
    expect(run([unavailable], diving)).toMatchObject({ phase: "fallback", reason: "authentication" });
    expect(run([{ type: "diveFinished", jumpId: 1 }, unavailable], diving)).toMatchObject({ phase: "fallback" });
    const realm = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "diveFinished", jumpId: 1 }, { type: "skipRequested" }], diving);
    expect(run([{ type: "sceneStatusReceived", jumpId: 1, status: UNAVAILABLE }], realm)).toMatchObject({ phase: "fallback", reason: undefined });
  });

  it("6. cancelling while holding returns to browsing and the abandoned jump is ignored after", () => {
    const holding = run([{ type: "diveFinished", jumpId: 1 }], requested());
    const browsing = run([{ type: "cancelRequested" }], holding);
    expect(browsing).toMatchObject({ phase: "browsing", slug: "kyoto" });
    expect(run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }], browsing)).toBe(browsing);
  });

  it("7. a status from a superseded jump is ignored", () => {
    const first = requested();
    const second = run([{ type: "cancelRequested" }, { type: "jumpRequested", slug: "banff", reducedMotion: false, transition: "wipe" }], first);
    const stale = { type: "sceneStatusReceived", jumpId: jumpIdOf(first), status: UNAVAILABLE } as const;
    expect(reduceOverlandJump(second, stale)).toBe(second);
    expect(reduceOverlandJump(second, { type: "diveFinished", jumpId: jumpIdOf(first) })).toBe(second);
  });

  it("8. leaving the realm surfaces, then browses again with the same route for focus", () => {
    const realm = run([{ type: "diveFinished", jumpId: 1 }, { type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "skipRequested" }], requested());
    const surfacing = run([{ type: "leaveRequested" }], realm);
    expect(surfacing).toMatchObject({ phase: "surfacing", slug: "kyoto" });
    expect(run([{ type: "surfaceFinished", jumpId: 1 }], surfacing)).toMatchObject({ phase: "browsing", slug: "kyoto" });
    expect(run([{ type: "leaveRequested" }], run([{ type: "sceneStatusReceived", jumpId: 1, status: UNAVAILABLE }], requested()))).toMatchObject({ phase: "browsing", slug: "kyoto" });
  });

  it("9. the presentation never shows an altered live map in the default jump", () => {
    const diving = requested();
    expect(jumpPresentation(initialOverlandJumpState())).toMatchObject({ liveMap: false });
    expect(jumpPresentation(diving)).toMatchObject({ liveMap: false, coverCoverage: 1 });
    let state = run([{ type: "diveFinished", jumpId: 1 }], diving);
    expect(jumpPresentation(state)).toMatchObject({ liveMap: false });
    state = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }], state);
    while (state.phase === "resolving") {
      expect(jumpPresentation(state)).toMatchObject({ liveMap: true, pixelLevel: 1 });
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(jumpPresentation(run([{ type: "sceneStatusReceived", jumpId: 1, status: UNAVAILABLE }], requested()))).toMatchObject({ liveMap: false });
  });

  it("10. any key or tap during the dive skips to its end: the realm when the scene is ready, else the hold", () => {
    const diving = requested();
    expect(run([{ type: "skipRequested" }], diving)).toMatchObject({ phase: "holding" });
    expect(run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "skipRequested" }], diving)).toMatchObject({ phase: "realm" });
    const holding = run([{ type: "diveFinished", jumpId: 1 }], diving);
    expect(reduceOverlandJump(holding, { type: "skipRequested" })).toBe(holding);
  });

  it("11. leaving reverses the wipe step by step, and a skip finishes the way out", () => {
    const realm = run([{ type: "diveFinished", jumpId: 1 }, { type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "skipRequested" }], requested());
    let state = run([{ type: "leaveRequested" }], realm);
    const coverages: number[] = [];
    while (!surfaceCovered(state)) {
      expect(jumpPresentation(state).liveMap).toBe(true);
      coverages.push(jumpPresentation(state).coverCoverage);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(coverages).toHaveLength(WIPE_STEPS);
    expect(coverages).toEqual([...coverages].sort((a, b) => a - b));
    expect(coverages[0]).toBe(0);
    expect(jumpPresentation(state).coverCoverage).toBe(1);
    expect(reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 })).toBe(state);
    expect(run([{ type: "skipRequested" }], run([{ type: "leaveRequested" }], realm))).toMatchObject({ phase: "browsing", slug: "kyoto" });
  });

  it("12. the live comparison leaves through the pixel levels in reverse, then the cover", () => {
    let state = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "diveFinished", jumpId: 1 }, { type: "skipRequested" }, { type: "leaveRequested" }], requested({ transition: "live" }));
    const levels: number[] = [];
    while (!surfaceCovered(state)) {
      expect(jumpPresentation(state).coverCoverage).toBe(0);
      levels.push(jumpPresentation(state).pixelLevel);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(levels).toEqual([...LIVE_PIXEL_LEVELS].reverse().slice(0, -1));
    expect(jumpPresentation(state).coverCoverage).toBe(1);
  });

  it("13. leaving before the scene is shown is a cancel", () => {
    expect(run([{ type: "leaveRequested" }], requested())).toMatchObject({ phase: "browsing", slug: "kyoto" });
    expect(run([{ type: "diveFinished", jumpId: 1 }, { type: "leaveRequested" }], requested())).toMatchObject({ phase: "browsing" });
  });

  it("14. from a town, the town itself is the cover: it fades in steps, and the live map is never altered", () => {
    let state = run([{ type: "diveFinished", jumpId: 1 }], requested({ transition: "town" }));
    expect(state).toMatchObject({ phase: "holding" });
    expect(jumpPresentation(state)).toMatchObject({ liveMap: false });
    state = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }], state);
    const opacities: number[] = [];
    while (state.phase === "resolving") {
      expect(jumpPresentation(state)).toMatchObject({ liveMap: true, pixelLevel: 1 });
      opacities.push(townCover(state).opacity);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(opacities).toHaveLength(WIPE_STEPS);
    expect(opacities[0]).toBe(1);
    expect(opacities).toEqual([...opacities].sort((a, b) => b - a));
    expect(state).toMatchObject({ phase: "realm" });
  });
});

describe("townCover", () => {
  const realmOf = (reducedMotion: boolean) =>
    run(
      reducedMotion
        ? [{ type: "sceneStatusReceived", jumpId: 1, status: READY }]
        : [{ type: "diveFinished", jumpId: 1 }, { type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "skipRequested" }],
      requested({ transition: "town", reducedMotion }),
    );

  it("is the town as it is while browsing, and gone in the realm", () => {
    expect(townCover(initialOverlandJumpState())).toEqual({ opacity: 1, above: false, clipBand: false, interactive: true, draws: true });
    expect(townCover(realmOf(false))).toMatchObject({ opacity: 0, above: false, interactive: false });
  });

  it("covers the map, whole, through the dive, the hold and the fallback", () => {
    const diving = requested({ transition: "town" });
    expect(townCover(diving)).toEqual({ opacity: 1, above: true, clipBand: false, interactive: false, draws: true });
    expect(townCover(run([{ type: "diveFinished", jumpId: 1 }], diving))).toMatchObject({ opacity: 1, above: true, clipBand: false });
    expect(townCover(run([{ type: "sceneStatusReceived", jumpId: 1, status: UNAVAILABLE }], diving))).toMatchObject({ opacity: 1, above: true });
  });

  it("leaves the attribution band clear whenever the live map shows beneath it", () => {
    let state: OverlandJumpState = run([{ type: "leaveRequested" }], realmOf(false));
    while (!surfaceCovered(state)) {
      const cover = townCover(state);
      if (cover.opacity > 0) expect(cover.clipBand).toBe(true);
      state = reduceOverlandJump(state, { type: "resolveStepElapsed", jumpId: 1 });
    }
    expect(townCover(state)).toMatchObject({ opacity: 1, clipBand: false });
  });

  it("with reduced motion, cuts in and fades back on the way out", () => {
    const realm = realmOf(true);
    expect(townCover(realm)).toMatchObject({ opacity: 0 });
    expect(townCover(run([{ type: "leaveRequested" }], realm))).toMatchObject({ opacity: 1, clipBand: true, above: true });
  });

  it("stops drawing while it only fades over the live map, and in the realm", () => {
    let state: OverlandJumpState = run([{ type: "diveFinished", jumpId: 1 }], requested({ transition: "town" }));
    expect(townCover(state).draws).toBe(true);
    state = run([{ type: "sceneStatusReceived", jumpId: 1, status: READY }, { type: "resolveStepElapsed", jumpId: 1 }], state);
    expect(state.phase).toBe("resolving");
    expect(townCover(state).draws).toBe(false);
    expect(townCover(realmOf(false)).draws).toBe(false);
    // On the way out it draws again once it covers the map, so its camera can pull back.
    let out: OverlandJumpState = run([{ type: "leaveRequested" }], realmOf(false));
    expect(townCover(out).draws).toBe(false);
    while (!surfaceCovered(out)) out = reduceOverlandJump(out, { type: "resolveStepElapsed", jumpId: 1 });
    expect(townCover(out).draws).toBe(true);
    // With reduced motion it fades back in whole, already home.
    expect(townCover(run([{ type: "leaveRequested" }], realmOf(true))).draws).toBe(true);
  });
});
