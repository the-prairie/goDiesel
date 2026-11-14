import { describe, expect, it } from "vitest";

import {
  ENTER_ZOOM,
  EXIT_ZOOM,
  eligibility,
  initialHandoverState,
  reduceHandover,
  type HandoverEvent,
  type HandoverState,
} from "@/labs/sketch/sketch-handover-state";

const run = (events: HandoverEvent[], from: HandoverState = initialHandoverState()) => events.reduce(reduceHandover, from);
const into = (zoom = ENTER_ZOOM + 0.5): HandoverEvent => ({ type: "zoomChanged", zoom, eligible: { ok: true, city: "Kyoto, Japan" }, nowMs: 1000 });
const out = (zoom = EXIT_ZOOM - 0.5): HandoverEvent => ({ type: "zoomChanged", zoom, eligible: { ok: true, city: "Kyoto, Japan" }, nowMs: 2000 });

describe("eligibility (S17.2)", () => {
  const capable = { webgl2: true, deviceMemoryGb: 8, saveData: false };

  it("hands over in a covered city on a capable device", () => {
    expect(eligibility({ city: "Kyoto, Japan", ...capable })).toEqual({ ok: true, city: "Kyoto, Japan" });
  });

  it("stays on the drawn city where Google has no 3D, without WebGL2, on a small device, or saving data", () => {
    expect(eligibility({ city: null, ...capable })).toEqual({ ok: false, reason: "no-coverage" });
    expect(eligibility({ city: "Kyoto, Japan", ...capable, webgl2: false })).toEqual({ ok: false, reason: "no-webgl2" });
    expect(eligibility({ city: "Kyoto, Japan", ...capable, deviceMemoryGb: 2 })).toEqual({ ok: false, reason: "low-memory" });
    expect(eligibility({ city: "Kyoto, Japan", ...capable, saveData: true })).toEqual({ ok: false, reason: "save-data" });
  });

  it("does not hold an unknown memory size against the device", () => {
    expect(eligibility({ city: "Kyoto, Japan", ...capable, deviceMemoryGb: undefined }).ok).toBe(true);
  });
});

describe("reduceHandover", () => {
  it("starts on the drawn (OpenStreetMap) city and stays there below the hand-over zoom", () => {
    expect(initialHandoverState()).toEqual({ phase: "drawn" });
    expect(run([into(ENTER_ZOOM - 0.1)])).toEqual({ phase: "drawn" });
  });

  it("loads the real city when zoomed into a covered city, keeping the drawn city on screen", () => {
    expect(run([into()])).toEqual({ phase: "loading", loadId: 1, city: "Kyoto, Japan", startedMs: 1000 });
  });

  it("fades in once the first view is drawn, then shows the real city", () => {
    const fading = run([into(), { type: "firstViewDrawn", loadId: 1 }]);
    expect(fading).toEqual({ phase: "fadingIn", loadId: 1, city: "Kyoto, Japan" });
    expect(run([{ type: "fadeFinished", loadId: 1 }], fading)).toEqual({ phase: "real", loadId: 1, city: "Kyoto, Japan" });
  });

  it("times the first view from the tiles' first arrival, not from the library's download", () => {
    // A slow library download (an unbundled dev server) is not a slow first view.
    const loading = run([into()]);
    expect(run([{ type: "timedOut", loadId: 1 }], loading)).toBe(loading);
    const started = run([{ type: "tilesStarted", loadId: 1, nowMs: 5000 }], loading);
    expect(started).toMatchObject({ phase: "loading", tilesStartedMs: 5000 });
    expect(run([{ type: "timedOut", loadId: 1 }], started)).toMatchObject({ phase: "declined", reason: "slow" });
  });

  it("still gives up if the tiles never start at all", () => {
    expect(run([into(), { type: "startTimedOut", loadId: 1 }])).toMatchObject({ phase: "declined", reason: "tiles" });
    const started = run([into(), { type: "tilesStarted", loadId: 1, nowMs: 5000 }]);
    expect(run([{ type: "startTimedOut", loadId: 1 }], started)).toBe(started);
  });

  it("falls back to the drawn city, and stays, when the first view is too slow or the tiles fail", () => {
    expect(run([into(), { type: "tilesStarted", loadId: 1, nowMs: 1 }, { type: "timedOut", loadId: 1 }])).toMatchObject({ phase: "declined", reason: "slow" });
    expect(run([into(), { type: "failed", loadId: 1 }])).toMatchObject({ phase: "declined", reason: "tiles" });
    // Declined, zooming about does not try again until the camera has left the city.
    const declined = run([into(), { type: "failed", loadId: 1 }]);
    expect(run([into(ENTER_ZOOM + 1)], declined)).toBe(declined);
  });

  it("declines at once for a reason the device or the place gives", () => {
    expect(run([{ type: "zoomChanged", zoom: ENTER_ZOOM + 1, eligible: { ok: false, reason: "save-data" }, nowMs: 0 }])).toMatchObject({ phase: "declined", reason: "save-data" });
  });

  it("fades back out and tears down below the exit zoom, and abandons a load still on its way", () => {
    const real = run([into(), { type: "firstViewDrawn", loadId: 1 }, { type: "fadeFinished", loadId: 1 }]);
    const leaving = run([out()], real);
    expect(leaving).toEqual({ phase: "fadingOut", loadId: 1 });
    expect(run([{ type: "fadeFinished", loadId: 1 }], leaving)).toMatchObject({ phase: "drawn" });
    expect(run([into(), out()])).toMatchObject({ phase: "drawn" });
  });

  it("holds between the exit and enter zooms, so it does not flicker at the edge", () => {
    const real = run([into(), { type: "firstViewDrawn", loadId: 1 }, { type: "fadeFinished", loadId: 1 }]);
    expect(run([{ type: "zoomChanged", zoom: (ENTER_ZOOM + EXIT_ZOOM) / 2, eligible: { ok: true, city: "Kyoto, Japan" }, nowMs: 3000 }], real)).toBe(real);
  });

  it("lets a declined city be tried again once the camera has left it", () => {
    const declined = run([into(), { type: "tilesStarted", loadId: 1, nowMs: 1 }, { type: "timedOut", loadId: 1 }]);
    expect(run([out(), into()], declined)).toEqual({ phase: "loading", loadId: 2, city: "Kyoto, Japan", startedMs: 1000 });
  });

  it("ignores answers from an abandoned load", () => {
    const again = run([into(), out(), into()]);
    expect(again).toMatchObject({ phase: "loading", loadId: 2 });
    expect(run([{ type: "firstViewDrawn", loadId: 1 }], again)).toBe(again);
  });
});
