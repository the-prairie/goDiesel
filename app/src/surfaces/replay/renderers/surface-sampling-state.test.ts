import { describe, expect, it } from "vitest";
import {
  initialSurfaceSamplingState,
  reduceSurfaceSampling as reduce,
  surfaceSampleRetryDelay,
} from "./surface-sampling-state";

const start = (atMs = 0) =>
  reduce(initialSurfaceSamplingState(), {
    type: "sampleRequested",
    atMs,
    supported: true,
  });

describe("surface sampling scheduler", () => {
  it("starts immediately and serializes requests until completion", () => {
    const state = start();
    expect(state).toMatchObject({
      phase: "sampling",
      retryLatest: false,
      lastStartedAtMs: 0,
    });
    expect(
      reduce(state, { type: "sampleRequested", atMs: 1000, supported: true }),
    ).toBe(state);
    const completed = reduce(state, {
      type: "sampleCompleted",
      requestId: state.requestId,
    });
    expect(
      reduce(completed, {
        type: "sampleRequested",
        atMs: 1000,
        supported: true,
      }),
    ).toMatchObject({ phase: "sampling", requestId: state.requestId + 1 });
  });

  it("opens the next request exactly at the throttle boundary", () => {
    const pending = start(100);
    const state = reduce(pending, {
      type: "sampleCompleted",
      requestId: pending.requestId,
    });
    expect(
      reduce(state, { type: "sampleRequested", atMs: 349, supported: true }),
    ).toBe(state);
    expect(
      reduce(state, { type: "sampleRequested", atMs: 350, supported: true })
        .phase,
    ).toBe("sampling");
  });

  it("throttles unsupported attempts without leaving a request pending", () => {
    const state = reduce(initialSurfaceSamplingState(), {
      type: "sampleRequested",
      atMs: 0,
      supported: false,
    });
    expect(state.phase).toBe("idle");
    expect(
      reduce(state, { type: "sampleRequested", atMs: 249, supported: true }),
    ).toBe(state);
    expect(
      reduce(state, { type: "sampleRequested", atMs: 250, supported: true })
        .phase,
    ).toBe("sampling");
  });

  it.each([true, false])(
    "records current observation retry intent %s until settlement",
    (retryLatest) => {
      const state = start();
      const observed = reduce(state, {
        type: "sampleObserved",
        requestId: state.requestId,
        retryLatest,
      });
      expect(observed).toMatchObject({ phase: "sampling", retryLatest });
      expect(
        reduce(observed, {
          type: "sampleCompleted",
          requestId: state.requestId,
        }),
      ).toEqual({
        phase: "idle",
        requestId: state.requestId,
        lastStartedAtMs: 0,
      });
    },
  );

  it("marks failures for retry and computes delay from the latest accepted start", () => {
    const state = start();
    expect(
      reduce(state, { type: "sampleFailed", requestId: state.requestId }),
    ).toMatchObject({ phase: "sampling", retryLatest: true });
    expect(surfaceSampleRetryDelay(state, 100)).toBe(150);
    expect(surfaceSampleRetryDelay(state, 500)).toBe(0);
    const completed = reduce(state, {
      type: "sampleCompleted",
      requestId: state.requestId,
    });
    const retried = reduce(completed, {
      type: "sampleRequested",
      atMs: 500,
      supported: true,
    });
    expect(surfaceSampleRetryDelay(retried, 500)).toBe(250);
  });

  it("ignores outcomes owned by older requests", () => {
    const state = start();
    expect(
      reduce(state, {
        type: "sampleObserved",
        requestId: 0,
        retryLatest: true,
      }),
    ).toBe(state);
    expect(reduce(state, { type: "sampleFailed", requestId: 0 })).toBe(state);
    expect(reduce(state, { type: "sampleCompleted", requestId: 0 })).toBe(
      state,
    );
  });

  it("ignores outcomes without pending work", () => {
    const state = initialSurfaceSamplingState();
    expect(
      reduce(state, {
        type: "sampleObserved",
        requestId: 0,
        retryLatest: true,
      }),
    ).toBe(state);
    expect(reduce(state, { type: "sampleFailed", requestId: 0 })).toBe(state);
    expect(reduce(state, { type: "sampleCompleted", requestId: 0 })).toBe(
      state,
    );
  });

  it("disposes pending work and permits a fresh unthrottled session", () => {
    const pending = start(100);
    const disposed = reduce(pending, { type: "disposed" });
    expect(
      reduce(disposed, { type: "sampleRequested", atMs: 101, supported: true }),
    ).toBe(disposed);
    expect(
      reduce(disposed, {
        type: "sampleCompleted",
        requestId: pending.requestId,
      }),
    ).toBe(disposed);
    const fresh = reduce(disposed, { type: "sessionStarted" });
    const resumed = reduce(fresh, {
      type: "sampleRequested",
      atMs: 101,
      supported: true,
    });
    expect(resumed.phase).toBe("sampling");
    expect(resumed.requestId).toBeGreaterThan(pending.requestId);
    expect(
      reduce(resumed, { type: "sampleFailed", requestId: pending.requestId }),
    ).toBe(resumed);
  });

  it("does not reopen an active session or reset its throttle", () => {
    const pending = start();
    expect(reduce(pending, { type: "sessionStarted" })).toBe(pending);
    const idle = reduce(pending, {
      type: "sampleCompleted",
      requestId: pending.requestId,
    });
    expect(reduce(idle, { type: "sessionStarted" })).toBe(idle);
  });
});
