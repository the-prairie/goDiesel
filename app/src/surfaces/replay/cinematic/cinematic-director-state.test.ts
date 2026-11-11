import { describe, expect, it } from "vitest";
import type { QuestRoute } from "@/domain/route";
import { cinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";
import { initialCinematicDirectorState, reduceCinematicDirector, type CinematicDirectorState } from "@/surfaces/replay/cinematic/cinematic-director-state";

const route = {
  distanceKm: 2,
  route: [
    { lat: 35, lng: 24, elev: 10, d: 0 },
    { lat: 35.01, lng: 24.01, elev: 30, d: 2_000 },
  ],
} as QuestRoute;
const opening = cinematicFrame(route, "feature", 0);
const initial = () => initialCinematicDirectorState(opening);
function request(state: CinematicDirectorState) {
  const next = reduceCinematicDirector(state, { type: "playRequested" });
  if (next.audioStart.state !== "pending") throw new Error("play request was not minted");
  return { state: next, requestId: next.audioStart.requestId };
}
function start(state: CinematicDirectorState) {
  const pending = request(state);
  return reduceCinematicDirector(pending.state, { type: "audioStarted", requestId: pending.requestId });
}

describe("cinematic director transitions", () => {
  it("starts paused with sound enabled and loading status", () => {
    expect(initial()).toEqual({ frame: opening, playback: "paused", audioStart: { state: "idle" }, lastAudioRequestId: 0, soundEnabled: true, status: { state: "loading", message: "Scouting the route." } });
  });

  it("selects a cut and pauses in one transition", () => {
    const frame = cinematicFrame(route, "intimate", 0);
    expect(reduceCinematicDirector(start(initial()), { type: "cutSelected", frame })).toMatchObject({ playback: "paused", frame });
  });

  it("seek pauses while a published animation frame retains playback", () => {
    const playing = start(initial());
    const frame = cinematicFrame(route, "feature", 4);
    expect(reduceCinematicDirector(playing, { type: "framePublished", frame })).toMatchObject({ playback: "playing", frame });
    expect(reduceCinematicDirector(playing, { type: "seeked", frame })).toMatchObject({ playback: "paused", frame });
  });

  it("restart resets the frame before audio completion changes playback", () => {
    const paused = reduceCinematicDirector(initial(), { type: "seeked", frame: cinematicFrame(route, "feature", 10) });
    const restarting = reduceCinematicDirector(paused, { type: "restartRequested", frame: opening });
    expect(restarting).toMatchObject({ playback: "paused", frame: opening });
    expect(start(restarting).playback).toBe("playing");
  });

  for (const type of ["cutSelected", "seeked", "sessionStarted"] as const) {
    it(`rejects late audio after ${type}`, () => {
      const pending = request(initial());
      const changed = reduceCinematicDirector(pending.state, { type, frame: cinematicFrame(route, "kinetic", 2) });
      expect(reduceCinematicDirector(changed, { type: "audioStarted", requestId: pending.requestId })).toBe(changed);
    });
  }

  it("pause cancels an audio start and rejects its later completion", () => {
    const pending = request(initial());
    const paused = reduceCinematicDirector(pending.state, { type: "playbackPaused" });
    expect(reduceCinematicDirector(paused, { type: "audioStarted", requestId: pending.requestId })).toBe(paused);
  });

  it("accepts only the newest start and ignores duplicate completion", () => {
    const first = request(initial());
    const second = request(first.state);
    expect(second.requestId).not.toBe(first.requestId);
    let state = second.state;
    expect(reduceCinematicDirector(state, { type: "audioStarted", requestId: first.requestId })).toBe(state);
    state = reduceCinematicDirector(state, { type: "audioStarted", requestId: second.requestId });
    expect(state.playback).toBe("playing");
    expect(reduceCinematicDirector(state, { type: "audioStarted", requestId: second.requestId })).toBe(state);
  });

  it("failed audio settles the matching request without changing prior playback", () => {
    for (const state of [initial(), start(initial())]) {
      const { state: pending, requestId } = request(state);
      expect(reduceCinematicDirector(pending, { type: "audioStartFailed", requestId: requestId - 1 })).toBe(pending);
      expect(reduceCinematicDirector(pending, { type: "audioStartFailed", requestId })).toMatchObject({ playback: state.playback, audioStart: { state: "idle" } });
    }
  });

  it("retains playback intent during provider failure and partial recovery", () => {
    let state = start(initial());
    for (const providerState of ["unavailable", "partial", "ready"] as const) {
      state = reduceCinematicDirector(state, { type: "rendererStatusReceived", status: { state: providerState, message: providerState } });
      expect(state.playback).toBe("playing");
      expect(state.status.state).toBe(providerState);
    }
  });

  it("mints a fresh request id after a cancelled start so a late completion cannot start the next one", () => {
    const first = request(initial());
    const paused = reduceCinematicDirector(first.state, { type: "playbackPaused" });
    const second = request(paused);
    expect(second.requestId).toBeGreaterThan(first.requestId);
    expect(reduceCinematicDirector(second.state, { type: "audioStarted", requestId: first.requestId })).toBe(second.state);
  });

  it("keeps minting request ids across sessions", () => {
    const first = request(initial());
    const restarted = reduceCinematicDirector(first.state, { type: "sessionStarted", frame: opening });
    expect(request(restarted).requestId).toBeGreaterThan(first.requestId);
  });

  it("sound preference is independent of playback, seeking, and session reset", () => {
    let state = reduceCinematicDirector(initial(), { type: "soundToggled" });
    state = start(state);
    state = reduceCinematicDirector(state, { type: "seeked", frame: opening });
    state = reduceCinematicDirector(state, { type: "sessionStarted", frame: opening });
    expect(state.soundEnabled).toBe(false);
    expect(reduceCinematicDirector(state, { type: "soundToggled" }).soundEnabled).toBe(true);
  });
});
