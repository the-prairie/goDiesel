import { describe, expect, it } from "vitest";
import type { QuestRoute } from "@/domain/route";
import { cinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";
import { initialCinematicDirectorState, reduceCinematicDirector } from "@/surfaces/replay/cinematic/cinematic-director-state";

const route = {
  distanceKm: 2,
  route: [
    { lat: 35, lng: 24, elev: 10, d: 0 },
    { lat: 35.01, lng: 24.01, elev: 30, d: 2_000 },
  ],
} as QuestRoute;
const opening = cinematicFrame(route, "feature", 0);
const initial = () => initialCinematicDirectorState(opening);

describe("cinematic director transitions", () => {
  it("starts paused with sound enabled and loading status", () => {
    expect(initial()).toEqual({ frame: opening, playback: "paused", soundEnabled: true, status: { state: "loading", message: "Scouting the route." } });
  });

  it("selects a cut and pauses in one transition", () => {
    const playing = reduceCinematicDirector(initial(), { type: "playbackStarted" });
    const frame = cinematicFrame(route, "intimate", 0);
    expect(reduceCinematicDirector(playing, { type: "cutSelected", frame })).toMatchObject({ playback: "paused", frame });
  });

  it("seek pauses while a published animation frame retains playback", () => {
    const playing = reduceCinematicDirector(initial(), { type: "playbackStarted" });
    const frame = cinematicFrame(route, "feature", 4);
    expect(reduceCinematicDirector(playing, { type: "framePublished", frame })).toMatchObject({ playback: "playing", frame });
    expect(reduceCinematicDirector(playing, { type: "seeked", frame })).toMatchObject({ playback: "paused", frame });
  });

  it("restart resets the frame before audio completion changes playback", () => {
    const paused = reduceCinematicDirector(initial(), { type: "seeked", frame: cinematicFrame(route, "feature", 10) });
    const restarting = reduceCinematicDirector(paused, { type: "restartRequested", frame: opening });
    expect(restarting).toMatchObject({ playback: "paused", frame: opening });
    expect(reduceCinematicDirector(restarting, { type: "playbackStarted" }).playback).toBe("playing");
  });

  it("preserves the characterized late audio completion after a cut or seek", () => {
    for (const type of ["cutSelected", "seeked"] as const) {
      const changed = reduceCinematicDirector(initial(), { type, frame: cinematicFrame(route, "kinetic", 2) });
      expect(reduceCinematicDirector(changed, { type: "playbackStarted" })).toMatchObject({ playback: "playing", frame: changed.frame });
    }
  });

  it("retains playback intent during provider failure and partial recovery", () => {
    let state = reduceCinematicDirector(initial(), { type: "playbackStarted" });
    for (const providerState of ["unavailable", "partial", "ready"] as const) {
      state = reduceCinematicDirector(state, { type: "rendererStatusReceived", status: { state: providerState, message: providerState } });
      expect(state.playback).toBe("playing");
      expect(state.status.state).toBe(providerState);
    }
  });

  it("sound preference is independent of playback, seeking, and session reset", () => {
    let state = reduceCinematicDirector(initial(), { type: "soundToggled" });
    state = reduceCinematicDirector(state, { type: "playbackStarted" });
    state = reduceCinematicDirector(state, { type: "seeked", frame: opening });
    state = reduceCinematicDirector(state, { type: "sessionStarted", frame: opening });
    expect(state.soundEnabled).toBe(false);
    expect(reduceCinematicDirector(state, { type: "soundToggled" }).soundEnabled).toBe(true);
  });
});
