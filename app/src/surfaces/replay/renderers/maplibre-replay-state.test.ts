import { describe, expect, it } from "vitest";
import {
  initialMapLibreReplayState,
  mapLibreReplayStatus,
  reduceMapLibreReplay as reduce,
} from "./maplibre-replay-state";

const start = () =>
  reduce(initialMapLibreReplayState(), { type: "mapStarted", operationId: 1 });
const error = (state: ReturnType<typeof start>) =>
  reduce(state, { type: "mapError", operationId: 1 });

describe("MapLibre Replay lifecycle", () => {
  it("ignores provider outcomes before a map is started", () => {
    const state = initialMapLibreReplayState();
    expect(mapLibreReplayStatus(state)).toBeUndefined();
    for (const type of ["mapError", "mapLoaded", "deadlineReached"] as const) {
      expect(reduce(state, { type, operationId: 0 })).toBe(state);
    }
  });

  it("waits through three errors and reports the fourth", () => {
    let state = start();
    for (let i = 0; i < 3; i++) state = error(state);
    expect(state).toMatchObject({ phase: "loading", errorCount: 3 });
    state = error(state);
    expect(state).toMatchObject({
      phase: "unavailable",
      reason: "errors",
      errorCount: 4,
    });
    expect(mapLibreReplayStatus(state)?.title).toBe("Atlas replay unavailable");
    expect(error(state)).toMatchObject({
      phase: "unavailable",
      reason: "errors",
      errorCount: 4,
    });
  });

  it("allows the deadline after errors and errors after the deadline", () => {
    let state = start();
    for (let i = 0; i < 4; i++) state = error(state);
    state = reduce(state, { type: "deadlineReached", operationId: 1 });
    expect(mapLibreReplayStatus(state)?.title).toBe("Atlas replay timed out");
    expect(mapLibreReplayStatus(error(state))?.title).toBe(
      "Atlas replay unavailable",
    );
  });

  it.each(["errors", "deadline"] as const)(
    "recovers from %s on late load",
    (reason) => {
      let state = start();
      if (reason === "errors") for (let i = 0; i < 4; i++) state = error(state);
      else state = reduce(state, { type: "deadlineReached", operationId: 1 });
      const ready = reduce(state, { type: "mapLoaded", operationId: 1 });
      expect(ready.phase).toBe("ready");
      expect(mapLibreReplayStatus(ready)?.title).toBe("Atlas replay ready");
    },
  );

  it("keeps readiness through errors and the deadline", () => {
    let state = reduce(start(), { type: "mapLoaded", operationId: 1 });
    for (let i = 0; i < 8; i++) state = error(state);
    expect(state.phase).toBe("ready");
    expect(reduce(state, { type: "deadlineReached", operationId: 1 })).toBe(
      state,
    );
  });

  it("rejects retired operation outcomes and nonincreasing starts", () => {
    const state = reduce(start(), { type: "mapStarted", operationId: 2 });
    for (const type of [
      "mapError",
      "mapLoaded",
      "deadlineReached",
      "mapStarted",
    ] as const) {
      expect(reduce(state, { type, operationId: 1 })).toBe(state);
    }
    expect(reduce(state, { type: "mapStarted", operationId: 2 })).toBe(state);
  });

  it("disposes pending work and resets errors for a subsequent mount", () => {
    const disposed = reduce(error(start()), { type: "disposed" });
    expect(mapLibreReplayStatus(disposed)).toBeUndefined();
    for (const type of ["mapError", "mapLoaded", "deadlineReached"] as const) {
      expect(reduce(disposed, { type, operationId: 1 })).toBe(disposed);
    }
    expect(reduce(disposed, { type: "mapStarted", operationId: 3 })).toEqual({
      phase: "loading",
      operationId: 3,
      errorCount: 0,
    });
  });

  it("retains existing readiness and error budget if mounted again without disposal", () => {
    const errored = error(start());
    expect(
      reduce(errored, { type: "mapStarted", operationId: 2 }),
    ).toMatchObject({ phase: "loading", errorCount: 1 });
    const ready = reduce(errored, { type: "mapLoaded", operationId: 1 });
    expect(reduce(ready, { type: "mapStarted", operationId: 2 })).toMatchObject(
      { phase: "ready", errorCount: 1 },
    );
  });
});
