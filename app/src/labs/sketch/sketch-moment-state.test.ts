import { describe, expect, it } from "vitest";

import { initialMomentState, reduceMoment, type MomentEvent, type MomentState } from "@/labs/sketch/sketch-moment-state";

const from = { center: [135.77, 35] as [number, number], zoom: 15, pitch: 40, bearing: 10 };
const run = (events: MomentEvent[], state: MomentState = initialMomentState()) => events.reduce(reduceMoment, state);

describe("a planted moment's lifecycle", () => {
  it("approaches on a tap, remembering where she was, then opens muted with its media loading", () => {
    const approaching = run([{ type: "tapped", id: "tv-storefront", from, saveData: false, clip: true }]);
    expect(approaching).toEqual({ phase: "approaching", id: "tv-storefront", from, saveData: false, clip: true });
    expect(run([{ type: "arrived" }], approaching)).toEqual({ phase: "open", id: "tv-storefront", from, media: "loading", sound: false });
  });

  it("plays once the media is ready, takes sound on and off, and shows no signal if it fails", () => {
    const open = run([{ type: "tapped", id: "tv-storefront", from, saveData: false, clip: true }, { type: "arrived" }]);
    const playing = run([{ type: "mediaReady" }], open);
    expect(playing).toMatchObject({ media: "playing", sound: false });
    expect(run([{ type: "soundToggled" }], playing)).toMatchObject({ sound: true });
    expect(run([{ type: "soundToggled" }, { type: "soundToggled" }], playing)).toMatchObject({ sound: false });
    expect(run([{ type: "mediaFailed" }], open)).toMatchObject({ media: "failed", sound: false });
    // No sound to give with no signal.
    expect(run([{ type: "mediaFailed" }, { type: "soundToggled" }], open)).toMatchObject({ sound: false });
  });

  it("opens straight to no signal when the entry has no clip, Save-Data or not", () => {
    for (const saveData of [false, true]) {
      expect(run([{ type: "tapped", id: "tv-storefront", from, saveData, clip: false }, { type: "arrived" }])).toMatchObject({ phase: "open", media: "failed" });
    }
  });

  it("holds the media back with Save-Data until asked", () => {
    const held = run([{ type: "tapped", id: "tv-storefront", from, saveData: true, clip: true }, { type: "arrived" }]);
    expect(held).toMatchObject({ phase: "open", media: "held" });
    expect(run([{ type: "playRequested" }], held)).toMatchObject({ media: "loading" });
  });

  it("leaves back to where she was, from approaching or open, and Escape does the same", () => {
    const open = run([{ type: "tapped", id: "tv-storefront", from, saveData: false, clip: true }, { type: "arrived" }, { type: "mediaReady" }, { type: "soundToggled" }]);
    const leaving = run([{ type: "backRequested" }], open);
    expect(leaving).toEqual({ phase: "leaving", id: "tv-storefront", from });
    expect(run([{ type: "left" }], leaving)).toEqual({ phase: "closed" });
    const early = run([{ type: "tapped", id: "tv-storefront", from, saveData: false, clip: true }, { type: "backRequested" }]);
    expect(early).toEqual({ phase: "leaving", id: "tv-storefront", from });
  });

  it("ignores events that do not belong to the phase", () => {
    expect(run([{ type: "arrived" }])).toEqual({ phase: "closed" });
    const open = run([{ type: "tapped", id: "tv-storefront", from, saveData: false, clip: true }, { type: "arrived" }]);
    expect(run([{ type: "tapped", id: "other", from, saveData: false, clip: true }], open)).toBe(open);
    expect(run([{ type: "mediaReady" }], run([{ type: "backRequested" }], open))).toMatchObject({ phase: "leaving" });
  });
});
