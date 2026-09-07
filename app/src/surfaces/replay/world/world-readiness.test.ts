import { describe, expect, it } from "vitest";
import { advanceTerrainReadiness, INITIAL_TERRAIN_READINESS } from "./world-readiness";

describe("terrain startup and refinement", () => {
  it("does not promote completed downloads without an actual terrain draw", () => {
    let state = INITIAL_TERRAIN_READINESS;
    for (let i = 0; i < 100; i++) state = advanceTerrainReadiness(state, 0, 1);
    expect(state.ready).toBe(false);
  });
  it("requires consecutive real draws, not a single transient callback", () => {
    let state = advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, 1, 1);
    expect(state.ready).toBe(false);
    state = advanceTerrainReadiness(state, 0, 1);
    state = advanceTerrainReadiness(state, 1, 1);
    expect(state.ready).toBe(false);
    expect(advanceTerrainReadiness(state, 1, 1).ready).toBe(true);
  });
  it("releases a visibly drawn scene while its detail is still streaming", () => {
    const first = advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, 12, 0.24);
    const visible = advanceTerrainReadiness(first, 52, 0.47);
    expect(visible).toEqual({ consecutiveDraws: 2, ready: true, refining: true });
    // The Crete regression: over one hundred meshes drawn before the old 35s
    // deadline, but the global download/parse queue had not reached 90%.
    expect(advanceTerrainReadiness(visible, 111, 0.79)).toMatchObject({ ready: true, refining: true });
  });
  it("clears the partial refinement state when detail settles", () => {
    const first = advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, 1, 0.1);
    const ready = advanceTerrainReadiness(first, 1, 0.1);
    expect(advanceTerrainReadiness(ready, 30, 1)).toMatchObject({ ready: true, refining: false });
  });
  it("does not restart initial loading when a seek queues more detail", () => {
    const first = advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, 1, 1);
    const ready = advanceTerrainReadiness(first, 1, 1);
    expect(advanceTerrainReadiness(ready, 4, 0.1)).toMatchObject({ ready: true, refining: true });
    expect(advanceTerrainReadiness(ready, 0, 1)).toMatchObject({ ready: true, refining: true });
  });
  it("never interprets invalid draw counts as render evidence", () => {
    for (const meshes of [NaN, Infinity, -1]) {
      expect(advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, meshes, 1).ready).toBe(false);
    }
  });
  it("does not claim settled detail when provider progress is unavailable", () => {
    const first = advanceTerrainReadiness(INITIAL_TERRAIN_READINESS, 1, NaN);
    expect(advanceTerrainReadiness(first, 1, NaN)).toMatchObject({ ready: true, refining: true });
  });
});
