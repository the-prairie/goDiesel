import { describe, expect, it } from "vitest";

import {
  initialGoogleRendererState,
  reduceGoogleRenderer,
  type GoogleRendererEvent,
  type GoogleRendererState,
} from "@/surfaces/replay/renderers/google-renderer-state";

function started() {
  return reduceGoogleRenderer(initialGoogleRendererState(), { type: "mountStarted" });
}

function scene() {
  return reduceGoogleRenderer(started(), { type: "apiLoaded", operationId: 1 });
}

const outcomes: GoogleRendererEvent[] = [
  { type: "inputsRejected", operationId: 1, reason: "key" },
  { type: "apiLoaded", operationId: 1 },
  { type: "authenticationRejected", operationId: 1 },
  { type: "sceneErrored", operationId: 1 },
  { type: "sceneReady", operationId: 1 },
  { type: "operationFailed", operationId: 1, message: "Provider unavailable." },
];

describe("Google renderer lifecycle transitions", () => {
  it("begins idle and creates a loading operation on mount", () => {
    expect(initialGoogleRendererState()).toEqual({ phase: "idle", operationId: 0, status: null });
    expect(started()).toEqual({
      phase: "loadingApi", operationId: 1,
      status: { state: "loading", message: "Loading Google photorealistic 3D." },
    });
  });

  it.each(["key", "geometry"] as const)("settles missing %s before requesting a scene", (reason) => {
    const state = reduceGoogleRenderer(started(), { type: "inputsRejected", operationId: 1, reason });
    expect(state.phase).toBe("unavailable");
    expect(state.status?.message).toBe(reason === "key"
      ? "A Google Maps JavaScript API browser key is required."
      : "Recorded route geometry is unavailable.");
    expect(reduceGoogleRenderer(state, { type: "apiLoaded", operationId: 1 })).toBe(state);
    expect(reduceGoogleRenderer(state, { type: "sceneReady", operationId: 1 })).toBe(state);
  });

  it("loading the API preserves the current notice without publishing a new status", () => {
    const loading = started();
    expect(reduceGoogleRenderer(loading, { type: "apiLoaded", operationId: 1 })).toEqual({ ...loading, phase: "loadingScene" });
    expect(reduceGoogleRenderer(loading, { type: "apiLoaded", operationId: 1 }).status).toBe(loading.status);
  });

  it.each(["api", "scene"])("keeps pending %s work recoverable after authentication failure", (phase) => {
    let state = phase === "api" ? started() : scene();
    state = reduceGoogleRenderer(state, { type: "authenticationRejected", operationId: 1 });
    expect(state).toMatchObject({ phase: phase === "api" ? "loadingApi" : "loadingScene", status: { state: "unavailable" } });
    if (phase === "api") state = reduceGoogleRenderer(state, { type: "apiLoaded", operationId: 1 });
    expect(reduceGoogleRenderer(state, { type: "sceneReady", operationId: 1 })).toEqual({
      phase: "ready", operationId: 1,
      status: { state: "ready", message: "Native Google 3D route world ready." },
    });
  });

  it("lets the scene wait settle its own failure after an error notice", () => {
    const notice = reduceGoogleRenderer(scene(), { type: "sceneErrored", operationId: 1 });
    expect(notice).toMatchObject({ phase: "loadingScene", status: { state: "unavailable" } });
    const failed = reduceGoogleRenderer(notice, { type: "operationFailed", operationId: 1, message: "Scene failed." });
    expect(failed).toEqual({ phase: "unavailable", operationId: 1, status: { state: "unavailable", message: "Scene failed." } });
    expect(reduceGoogleRenderer(failed, { type: "sceneReady", operationId: 1 })).toBe(failed);
  });

  it.each(["authenticationRejected", "sceneErrored"] as const)("settles %s after readiness without a new pending scene", (type) => {
    const ready = reduceGoogleRenderer(scene(), { type: "sceneReady", operationId: 1 });
    const failed = reduceGoogleRenderer(ready, { type, operationId: 1 });
    expect(failed).toMatchObject({ phase: "unavailable", status: { state: "unavailable" } });
    expect(reduceGoogleRenderer(failed, { type: "sceneReady", operationId: 1 })).toBe(failed);
  });

  it.each(["api", "scene"])("keeps a settled %s failure unavailable until another mount", (phase) => {
    const state = reduceGoogleRenderer(phase === "api" ? started() : scene(), {
      type: "operationFailed", operationId: 1, message: "Deadline expired.",
    });
    expect(reduceGoogleRenderer(state, { type: "sceneReady", operationId: 1 })).toBe(state);
    expect(reduceGoogleRenderer(state, { type: "operationFailed", operationId: 1, message: "Late failure." })).toBe(state);
    expect(reduceGoogleRenderer(state, { type: "mountStarted" })).toMatchObject({ phase: "loadingApi", operationId: 2, status: { state: "loading" } });
  });

  it("ignores scene events before API success and input rejection after scene creation", () => {
    const loading = started();
    for (const type of ["sceneReady", "sceneErrored"] as const) {
      expect(reduceGoogleRenderer(loading, { type, operationId: 1 })).toBe(loading);
    }
    const pending = scene();
    expect(reduceGoogleRenderer(pending, { type: "inputsRejected", operationId: 1, reason: "key" })).toBe(pending);
    expect(reduceGoogleRenderer(pending, { type: "apiLoaded", operationId: 1 })).toBe(pending);
  });

  it("ignores every outcome from an operation replaced during loading", () => {
    const replacement = reduceGoogleRenderer(scene(), { type: "mountStarted" });
    for (const outcome of outcomes) expect(reduceGoogleRenderer(replacement, outcome)).toBe(replacement);
  });

  it("destroy invalidates pending outcomes and permits a fresh mount", () => {
    const destroyed = reduceGoogleRenderer(scene(), { type: "destroyed" });
    expect(destroyed).toEqual({ phase: "destroyed", operationId: 2, status: null });
    for (const outcome of outcomes) expect(reduceGoogleRenderer(destroyed, outcome)).toBe(destroyed);
    expect(reduceGoogleRenderer(destroyed, { type: "mountStarted" })).toMatchObject({ phase: "loadingApi", operationId: 3 });
  });

  it("ignores outcomes without an active operation", () => {
    for (const phase of ["idle", "destroyed"] as const) {
      const inactive: GoogleRendererState = { phase, operationId: 1, status: null };
      for (const outcome of outcomes) expect(reduceGoogleRenderer(inactive, outcome)).toBe(inactive);
    }
  });
});
