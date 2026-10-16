import { describe, expect, it } from "vitest";
import {
  initialPlayableEarthSessionState,
  reducePlayableEarthSession,
} from "./playable-earth-session-state";

const ready = { state: "ready", title: "Ready", message: "Available" } as const;
const unavailable = {
  state: "unavailable",
  title: "Unavailable",
  message: "Tile failure",
} as const;

function started() {
  return reducePlayableEarthSession(initialPlayableEarthSessionState(), {
    type: "sessionStarted",
    sessionId: 1,
  });
}

describe("Playable Earth session", () => {
  it("starts paused with recorded grounding and independent desktop presentation", () => {
    const state = started();
    expect(state.status.state).toBe("loading");
    expect(state.grounding).toEqual({ source: "fallback", reason: "recorded" });
    expect(state.control).toMatchObject({
      playing: false,
      progressM: 0,
      mode: "replay",
      cameraRangeM: 720,
    });
    expect(state.contextState).toBe("preview");
  });

  it("preserves keyboard intent through loading, failure, and recovery", () => {
    let state = started();
    state = reducePlayableEarthSession(state, {
      type: "controlPublished",
      control: {
        ...state.control,
        mode: "guided",
        playing: true,
        progressM: 1200,
      },
    });
    for (const status of [ready, unavailable, ready]) {
      state = reducePlayableEarthSession(state, {
        type: "providerReported",
        sessionId: 1,
        status,
      });
      expect(state.status).toEqual(status);
      expect(state.control).toMatchObject({
        playing: true,
        mode: "guided",
        progressM: 1200,
      });
    }
  });

  it("compacts details only on playback start and permits reopening while playing", () => {
    let state = started();
    state = reducePlayableEarthSession(state, {
      type: "contextChanged",
      contextState: "expanded",
    });
    state = reducePlayableEarthSession(state, {
      type: "controlPublished",
      control: { ...state.control, playing: true },
    });
    expect(state.contextState).toBe("compact");
    state = reducePlayableEarthSession(state, {
      type: "contextChanged",
      contextState: "expanded",
    });
    state = reducePlayableEarthSession(state, {
      type: "controlPublished",
      control: { ...state.control, progressM: 12 },
    });
    expect(state.contextState).toBe("expanded");
    state = reducePlayableEarthSession(state, {
      type: "controlPublished",
      control: { ...state.control, playing: false },
    });
    expect(state.contextState).toBe("expanded");
  });

  it("resets controls and provenance for a new session without resetting presentation early", () => {
    let state = started();
    state = reducePlayableEarthSession(state, {
      type: "groundingReported",
      sessionId: 1,
      grounding: { source: "sampled", reason: "sampled", offsetM: 8.5 },
    });
    state = reducePlayableEarthSession(state, {
      type: "controlPublished",
      control: { ...state.control, playing: true, progressM: 400, speed: 4 },
    });
    state = reducePlayableEarthSession(state, { type: "controlsToggled" });
    state = reducePlayableEarthSession(state, {
      type: "sessionStarted",
      sessionId: 3,
    });
    expect(state.control).toEqual(initialPlayableEarthSessionState().control);
    expect(state.grounding).toEqual({ source: "fallback", reason: "recorded" });
    expect(state.status.state).toBe("loading");
    expect(state.contextState).toBe("compact");
    expect(state.mobileControlsExpanded).toBe(true);
  });

  it("ignores provider and grounding outcomes from an old session", () => {
    const state = reducePlayableEarthSession(started(), {
      type: "sessionStarted",
      sessionId: 3,
    });
    expect(
      reducePlayableEarthSession(state, {
        type: "providerReported",
        sessionId: 1,
        status: ready,
      }),
    ).toBe(state);
    expect(
      reducePlayableEarthSession(state, {
        type: "groundingReported",
        sessionId: 1,
        grounding: { source: "sampled", reason: "sampled", offsetM: 9 },
      }),
    ).toBe(state);
  });

  it("viewport reset preserves the world while collapsing mobile controls", () => {
    let state = reducePlayableEarthSession(started(), {
      type: "providerReported",
      sessionId: 1,
      status: ready,
    });
    state = reducePlayableEarthSession(state, { type: "controlsToggled" });
    state = reducePlayableEarthSession(state, {
      type: "presentationReset",
      isMobile: true,
    });
    expect(state.contextState).toBe("compact");
    expect(state.mobileControlsExpanded).toBe(false);
    expect(state.status).toEqual(ready);
    state = reducePlayableEarthSession(state, {
      type: "presentationReset",
      isMobile: false,
    });
    expect(state.contextState).toBe("preview");
  });

  it("grounding changes preserve playback and expanded controls", () => {
    let state = reducePlayableEarthSession(started(), {
      type: "controlsToggled",
    });
    const control = state.control;
    state = reducePlayableEarthSession(state, {
      type: "groundingReported",
      sessionId: 1,
      grounding: { source: "sampled", reason: "sampled", offsetM: 8.5 },
    });
    expect(state.grounding.offsetM).toBe(8.5);
    expect(state.control).toBe(control);
    expect(state.mobileControlsExpanded).toBe(true);
    state = reducePlayableEarthSession(state, { type: "controlsToggled" });
    expect(state.mobileControlsExpanded).toBe(false);
  });
});
