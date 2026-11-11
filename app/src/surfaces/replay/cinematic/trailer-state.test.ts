import { describe, expect, it } from "vitest";
import type { QuestRoute } from "@/domain/route";
import {
  routeTrailerFrame,
  ROUTE_TRAILER_DURATION_SECONDS,
} from "./route-trailer-controller";
import { initialTrailerState, reduceTrailer } from "./trailer-state";

const route = {
  distanceKm: 20,
  centerLat: 35.2,
  centerLng: 24.8,
  route: [
    { lat: 35.1, lng: 24.7, elev: 20, d: 0 },
    { lat: 35.3, lng: 24.9, elev: 80, d: 20000 },
  ],
} as QuestRoute;
const opening = routeTrailerFrame(route, 0);
const final = routeTrailerFrame(route, ROUTE_TRAILER_DURATION_SECONDS);
const start = () =>
  reduceTrailer(initialTrailerState(opening), {
    type: "sessionStarted",
    frame: opening,
  });
const ready = () =>
  reduceTrailer(start(), {
    type: "providerReady",
    sessionId: 1,
    message: "Ready",
    frame: opening,
    reducedMotion: false,
  });
describe("trailer session transitions", () => {
  it("starts paused while the provider loads", () => {
    expect(start()).toMatchObject({
      playback: "paused",
      status: { state: "loading" },
      frame: opening,
    });
  });
  it.each([false, true])(
    "applies readiness and reduced motion %s atomically",
    (reducedMotion) => {
      const state = reduceTrailer(start(), {
        type: "providerReady",
        sessionId: 1,
        message: "Ready",
        frame: reducedMotion ? final : opening,
        reducedMotion,
      });
      expect(state.status.state).toBe("ready");
      expect(state.playback).toBe(reducedMotion ? "paused" : "playing");
      expect(state.frame.showDecision).toBe(reducedMotion);
    },
  );
  it("retains frame and playback intent through provider failure", () => {
    const previous = ready();
    const state = reduceTrailer(previous, {
      type: "providerReported",
      sessionId: 1,
      status: { state: "unavailable", message: "Failed" },
    });
    expect(state.frame).toBe(previous.frame);
    expect(state.playback).toBe("playing");
    expect(state.status.state).toBe("unavailable");
  });
  it("pauses without changing a frame and resumes without restarting", () => {
    const playing = ready();
    const paused = reduceTrailer(playing, {
      type: "playbackChanged",
      playing: false,
    });
    expect(paused.frame).toBe(playing.frame);
    expect(paused.playback).toBe("paused");
    expect(
      reduceTrailer(paused, { type: "playbackChanged", playing: true }).frame,
    ).toBe(playing.frame);
  });
  it("skips to the decision and restarts from the opening atomically", () => {
    const skipped = reduceTrailer(ready(), { type: "skipped", frame: final });
    expect(skipped).toMatchObject({ playback: "paused", frame: final });
    expect(
      reduceTrailer(skipped, { type: "restarted", frame: opening }),
    ).toMatchObject({ playback: "playing", frame: opening });
  });
  it("publishes throttled progress without changing playback intent", () => {
    const state = reduceTrailer(ready(), {
      type: "framePublished",
      frame: routeTrailerFrame(route, 5),
    });
    expect(state.frame.chapter).toBe("the-line");
    expect(state.playback).toBe("playing");
  });
  it("rejects provider outcomes from replaced sessions", () => {
    const state = reduceTrailer(ready(), {
      type: "sessionStarted",
      frame: opening,
    });
    expect(state.sessionId).toBe(2);
    expect(
      reduceTrailer(state, {
        type: "providerReady",
        sessionId: 1,
        message: "Old",
        frame: final,
        reducedMotion: true,
      }),
    ).toBe(state);
    expect(
      reduceTrailer(state, {
        type: "providerReported",
        sessionId: 1,
        status: { state: "unavailable", message: "Old" },
      }),
    ).toBe(state);
  });
  it("mints a new session id on every session start", () => {
    expect(start().sessionId).toBe(1);
    expect(
      reduceTrailer(start(), { type: "sessionStarted", frame: opening })
        .sessionId,
    ).toBe(2);
  });
  it("a new session starts paused at its opening frame", () => {
    const state = reduceTrailer(
      reduceTrailer(ready(), { type: "skipped", frame: final }),
      { type: "restarted", frame: opening },
    );
    expect(state.playback).toBe("playing");
    const next = reduceTrailer(state, {
      type: "sessionStarted",
      frame: opening,
    });
    expect(next).toMatchObject({
      playback: "paused",
      status: { state: "loading" },
      frame: opening,
    });
  });
  describe("events the stage only sends while the provider is ready", () => {
    const notReady = {
      loading: () => start(),
      unavailable: () =>
        reduceTrailer(ready(), {
          type: "providerReported",
          sessionId: 1,
          status: { state: "unavailable", message: "Failed" },
        }),
    };
    for (const [phase, make] of Object.entries(notReady)) {
      it(`ignores playback, skip and frame publication while ${phase}`, () => {
        const state = make();
        expect(
          reduceTrailer(state, { type: "playbackChanged", playing: false }),
        ).toBe(state);
        expect(
          reduceTrailer(state, { type: "playbackChanged", playing: true }),
        ).toBe(state);
        expect(reduceTrailer(state, { type: "skipped", frame: final })).toBe(
          state,
        );
        expect(
          reduceTrailer(state, {
            type: "framePublished",
            frame: routeTrailerFrame(route, 5),
          }),
        ).toBe(state);
      });
      it(`still accepts a restart while ${phase}`, () => {
        expect(
          reduceTrailer(make(), { type: "restarted", frame: opening }),
        ).toMatchObject({ playback: "playing", frame: opening });
      });
    }
  });
});
