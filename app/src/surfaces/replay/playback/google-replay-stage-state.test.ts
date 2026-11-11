import { describe, expect, it } from "vitest";

import {
  GOOGLE_REPLAY_INITIAL_STATUS,
  googleReplayIntentEvents,
  initialGoogleReplayStageState,
  reduceGoogleReplayStage,
  type GoogleReplayIntent,
  type GoogleReplayStageEvent,
  type GoogleReplayStageState,
} from "@/surfaces/replay/playback/google-replay-stage-state";
import {
  initialReplayChapterControlsState,
  reduceReplayChapterControls,
  type ReplayChapterControlsEvent,
  type ReplayChapterControlsState,
} from "@/surfaces/replay/playback/replay-chapter-controls-state";
import type { ReplayChapter, ReplayMoment } from "@/surfaces/replay/playback/replay-chapter-model";
import { initialReplaySessionState } from "@/surfaces/replay/playback/replay-session-state";
import type { GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";

const TOTAL_M = 4_000;
const ready: GoogleRouteNavigatorStatus = { state: "ready", message: "Native Google 3D route world ready." };
const loading: GoogleRouteNavigatorStatus = { state: "loading", message: "Loading Google Maps." };
const authNotice: GoogleRouteNavigatorStatus = {
  state: "unavailable",
  message: "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
};

const chapter: ReplayChapter = { id: "chapter-2", index: 1, label: "Rolling", startM: 1_000, endM: 2_000, ascentM: 25, descentM: 30 };
const moment: ReplayMoment = { id: "high", kind: "high-point", label: "High point", startM: 1_200, endM: 1_800, anchorM: 1_500, valueM: 50, explanation: "Highest recorded elevation sample." };

function transition(state: GoogleReplayStageState, ...events: GoogleReplayStageEvent[]) {
  return events.reduce(reduceGoogleReplayStage, state);
}

const control = (event: Extract<GoogleReplayStageEvent, { type: "controlRequested" }>["event"]): GoogleReplayStageEvent =>
  ({ type: "controlRequested", event });
const status = (sessionId: number, next: GoogleRouteNavigatorStatus): GoogleReplayStageEvent =>
  ({ type: "statusReceived", sessionId, status: next });
const frame = (elapsedSeconds = 0.1) => control({ type: "frameElapsed", elapsedSeconds, totalDistanceM: TOTAL_M });

function started(...events: GoogleReplayStageEvent[]) {
  return transition(initialGoogleReplayStageState(), { type: "sessionStarted" }, ...events);
}

/** Applies an intent to both reducers, as the stage adapter does. */
function perform(
  stage: GoogleReplayStageState,
  chapters: ReplayChapterControlsState,
  intent: GoogleReplayIntent,
) {
  const events = googleReplayIntentEvents(stage, chapters, intent);
  return {
    events,
    stage: transition(stage, ...events.control.map(control)),
    chapters: events.chapters.reduce(reduceReplayChapterControls, chapters),
  };
}

const browse = (event: ReplayChapterControlsEvent): GoogleReplayIntent => ({ type: "chapterBrowsed", event });

describe("Google Replay stage session", () => {
  // Component: useState(INITIAL_STATUS), useState(false) x2, initialReplaySessionState().
  it("starts loading, paused, following, with both disclosures closed", () => {
    expect(initialGoogleReplayStageState()).toEqual({
      sessionId: 0,
      status: GOOGLE_REPLAY_INITIAL_STATUS,
      control: initialReplaySessionState(),
      settingsOpen: false,
      chaptersExpanded: false,
    });
    expect(GOOGLE_REPLAY_INITIAL_STATUS).toEqual({ state: "loading", message: "Preparing the native Google 3D route world." });
  });

  // Component mount effect: routeReplaced on control, setSettingsOpen(false),
  // setChaptersExpanded(false), setStatus(INITIAL_STATUS).
  it("resets status, controls and disclosures in one mount event and opens a new session", () => {
    const used = transition(started(status(1, ready)),
      control({ type: "playbackToggled" }),
      control({ type: "progressSelected", progressM: 2_000, totalDistanceM: TOTAL_M }),
      control({ type: "cameraSelected", cameraMode: "overview" }),
      control({ type: "groundingSelected", groundingMode: "mesh" }),
      { type: "settingsOpenChanged", open: true },
      { type: "chaptersExpandedChanged", expanded: true },
    );
    expect(used).toMatchObject({ sessionId: 1, settingsOpen: true, chaptersExpanded: true, control: { playing: true, progressM: 2_000 } });
    expect(transition(used, { type: "sessionStarted" })).toEqual({
      ...initialGoogleReplayStageState(),
      sessionId: 2,
    });
  });

  // Component onStatus: setStatus(next) for every status of the live engine.
  it("accepts every provider status for the current session in order", () => {
    const loaded = started(status(1, loading));
    expect(loaded.status).toBe(loading);
    expect(transition(loaded, status(1, ready)).status).toBe(ready);
    expect(transition(loaded, status(1, ready), status(1, loading)).status).toBe(loading);
  });

  // Pinned by google-renderer-state "keeps pending work recoverable after
  // authentication failure": the engine reports the auth notice while the API
  // is still loading and can still report ready afterwards.
  it("treats an authentication notice during loading as recoverable", () => {
    const noticed = started({ type: "settingsOpenChanged", open: true }, status(1, authNotice));
    expect(noticed.status).toBe(authNotice);
    expect(noticed.settingsOpen).toBe(false);
    const recovered = transition(noticed, status(1, ready));
    expect(recovered.status).toBe(ready);
    expect(transition(recovered, control({ type: "playbackToggled" })).control.playing).toBe(true);
  });

  // Component onStatus: `if (next.state === "unavailable") setSettingsOpen(false)`.
  it("closes settings when the provider becomes unavailable and leaves other disclosures alone", () => {
    const open = started(status(1, ready), { type: "settingsOpenChanged", open: true }, { type: "chaptersExpandedChanged", expanded: true });
    const lost = transition(open, status(1, { state: "unavailable", message: "This browser could not start Google photorealistic 3D." }));
    expect(lost).toMatchObject({ settingsOpen: false, chaptersExpanded: true, status: { state: "unavailable" } });
    expect(transition(open, status(1, loading)).settingsOpen).toBe(true);
    expect(transition(open, status(1, ready)).settingsOpen).toBe(true);
  });

  // Component: Sheet onOpenChange={setSettingsOpen} is not gated on status.
  it("lets settings reopen after the provider was lost", () => {
    const lost = started(status(1, authNotice));
    expect(transition(lost, { type: "settingsOpenChanged", open: true }).settingsOpen).toBe(true);
  });

  // Component onStatus: `if (engineRef.current !== engine) return`.
  it("drops status from a superseded session", () => {
    const current = transition(started(status(1, ready)), { type: "sessionStarted" });
    expect(current.sessionId).toBe(2);
    expect(transition(current, status(1, ready))).toBe(current);
    expect(transition(current, status(1, authNotice))).toBe(current);
    expect(transition(current, status(3, ready))).toBe(current);
    expect(transition(current, status(2, ready)).status).toBe(ready);
  });

  // Pinned by e2e "retains keyboard play intent while the provider is loading":
  // togglePlayback commits regardless of status; the frame driver only runs
  // while ready.
  it("retains play intent pressed while loading and advances once ready", () => {
    const intent = started(control({ type: "playbackToggled" }));
    expect(intent.status.state).toBe("loading");
    expect(intent.control).toMatchObject({ playing: true, progressM: 0 });
    const live = transition(intent, status(1, ready), frame());
    expect(live.control.playing).toBe(true);
    expect(live.control.progressM).toBeGreaterThan(0);
    const reloading = transition(live, status(1, loading));
    expect(reloading.control).toEqual(live.control);
  });

  it("forwards every command to the shared session reducer in any provider phase", () => {
    const commanded = started(
      control({ type: "cameraSelected", cameraMode: "chase" }),
      control({ type: "followingChanged", following: false }),
      control({ type: "speedCycled" }),
      control({ type: "zoomRequested", direction: "in" }),
      control({ type: "groundingSelected", groundingMode: "mesh" }),
      control({ type: "progressSelected", progressM: 9_000, totalDistanceM: TOTAL_M }),
    );
    expect(commanded.control).toMatchObject({ cameraMode: "chase", following: false, speed: 2, groundingMode: "mesh", progressM: TOTAL_M });
    expect(commanded.control.rangeScale).toBeLessThan(1);
  });

  it("returns the same state for disclosure changes that change nothing", () => {
    const state = started();
    expect(transition(state, { type: "settingsOpenChanged", open: false })).toBe(state);
    expect(transition(state, { type: "chaptersExpandedChanged", expanded: false })).toBe(state);
    expect(transition(state, { type: "chaptersExpandedChanged", expanded: true }).chaptersExpanded).toBe(true);
  });
});

describe("Google Replay intents across the session and chapter browser", () => {
  const live = () => started(status(1, ready));
  const previewing = (stage = live()) => perform(stage, initialReplayChapterControlsState(), browse({ type: "momentSelected", moment }));

  // Component togglePlayback: replayReturned, then playbackToggled. Not gated.
  it("toggling playback leaves preview and toggles in every provider phase", () => {
    const { stage, chapters } = previewing();
    expect(chapters.mode).toBe("preview");
    const toggled = perform(stage, chapters, { type: "playbackToggled" });
    expect(toggled.events).toEqual({ control: [{ type: "playbackToggled" }], chapters: [{ type: "replayReturned" }] });
    expect(toggled.chapters.mode).toBe("following");
    expect(toggled.stage.control.playing).toBe(true);
    expect(perform(started(), initialReplayChapterControlsState(), { type: "playbackToggled" }).stage.control.playing).toBe(true);
  });

  // Component browseChapter: chapterSelected / momentSelected / previewMoved
  // need a ready provider and pause a playing session first.
  it.each([
    ["chapterSelected", { type: "chapterSelected", chapter }],
    ["momentSelected", { type: "momentSelected", moment }],
  ] as const)("%s pauses playback without seeking and opens a preview", (_name, event) => {
    const playing = transition(live(), control({ type: "progressSelected", progressM: 3_000, totalDistanceM: TOTAL_M }), control({ type: "playbackToggled" }));
    const browsed = perform(playing, initialReplayChapterControlsState(), browse(event));
    expect(browsed.events).toEqual({ control: [{ type: "playbackToggled" }], chapters: [event] });
    expect(browsed.stage.control).toMatchObject({ playing: false, progressM: 3_000 });
    expect(browsed.chapters.mode).toBe("preview");

    const paused = perform(live(), initialReplayChapterControlsState(), browse(event));
    expect(paused.events).toEqual({ control: [], chapters: [event] });
  });

  it("moving the preview pauses playback but never moves the session", () => {
    const { stage, chapters } = previewing();
    const resumed = transition(stage, control({ type: "playbackToggled" }));
    const moved = perform(resumed, chapters, browse({ type: "previewMoved", progressM: 1_700, totalDistanceM: TOTAL_M }));
    expect(moved.events.control).toEqual([{ type: "playbackToggled" }]);
    expect(moved.stage.control).toMatchObject({ playing: false, progressM: 0 });
    expect(moved.chapters).toMatchObject({ mode: "preview", progressM: 1_700 });
  });

  it.each([
    ["loading", loading],
    ["unavailable", authNotice],
  ] as const)("ignores chapter, moment and preview browsing while %s", (_name, providerStatus) => {
    const { stage, chapters } = previewing();
    const lost = transition(stage, control({ type: "playbackToggled" }), status(1, providerStatus));
    for (const event of [
      { type: "chapterSelected", chapter },
      { type: "momentSelected", moment },
      { type: "previewMoved", progressM: 1_700, totalDistanceM: TOTAL_M },
    ] as const) {
      expect(googleReplayIntentEvents(lost, chapters, browse(event))).toEqual({ control: [], chapters: [] });
    }
  });

  // Component browseChapter passes other chapter events straight through.
  it("passes scope and return events through in every provider phase without touching playback", () => {
    const { stage, chapters } = previewing();
    const lost = transition(stage, control({ type: "playbackToggled" }), status(1, loading));
    for (const event of [
      { type: "scopeChanged", scope: "whole", totalDistanceM: TOTAL_M },
      { type: "replayReturned" },
    ] as const) {
      expect(googleReplayIntentEvents(lost, chapters, browse(event))).toEqual({ control: [], chapters: [event] });
    }
  });

  // Component playFromPreview: requires ready + preview; seeks, returns, and
  // starts playback unless already playing or the seek reached the end.
  it("playing from a preview seeks to it, returns to the session and starts playback", () => {
    const { stage, chapters } = previewing(transition(live(), control({ type: "progressSelected", progressM: 500, totalDistanceM: TOTAL_M })));
    const played = perform(stage, chapters, { type: "previewPlayed", totalDistanceM: TOTAL_M });
    expect(played.events).toEqual({
      control: [{ type: "progressSelected", progressM: 1_500, totalDistanceM: TOTAL_M }, { type: "playbackToggled" }],
      chapters: [{ type: "replayReturned" }],
    });
    expect(played.stage.control).toMatchObject({ playing: true, progressM: 1_500 });
    expect(played.chapters.mode).toBe("following");
  });

  it("does not restart playback from a preview at the end of the route", () => {
    const atEnd = perform(live(), initialReplayChapterControlsState(), browse({ type: "chapterSelected", chapter: { ...chapter, startM: TOTAL_M, endM: TOTAL_M } }));
    const played = perform(atEnd.stage, atEnd.chapters, { type: "previewPlayed", totalDistanceM: TOTAL_M });
    expect(played.events.control).toEqual([{ type: "progressSelected", progressM: TOTAL_M, totalDistanceM: TOTAL_M }]);
    expect(played.stage.control).toMatchObject({ playing: false, progressM: TOTAL_M });
  });

  it("does not toggle a session that is already playing when playing from a preview", () => {
    const { stage, chapters } = previewing();
    const playing = transition(stage, control({ type: "playbackToggled" }));
    const played = perform(playing, chapters, { type: "previewPlayed", totalDistanceM: TOTAL_M });
    expect(played.events.control).toEqual([{ type: "progressSelected", progressM: 1_500, totalDistanceM: TOTAL_M }]);
    expect(played.stage.control).toMatchObject({ playing: true, progressM: 1_500 });
  });

  // Pinned by e2e "provider loss cannot commit a preview or move its paused session".
  it.each([
    ["loading", loading],
    ["unavailable", authNotice],
  ] as const)("cannot play from a preview while %s", (_name, providerStatus) => {
    const { stage, chapters } = previewing();
    const lost = transition(stage, status(1, providerStatus));
    expect(googleReplayIntentEvents(lost, chapters, { type: "previewPlayed", totalDistanceM: TOTAL_M })).toEqual({ control: [], chapters: [] });
  });

  it("cannot play from a preview that is not open", () => {
    expect(googleReplayIntentEvents(live(), initialReplayChapterControlsState(), { type: "previewPlayed", totalDistanceM: TOTAL_M }))
      .toEqual({ control: [], chapters: [] });
  });

  // Component onSeek: replayReturned, then progressSelected. Not gated.
  it("a full-route seek leaves preview and moves the session without changing playback", () => {
    const { stage, chapters } = previewing();
    const sought = perform(stage, chapters, { type: "seekRequested", progressM: 2_000, totalDistanceM: TOTAL_M });
    expect(sought.events).toEqual({
      control: [{ type: "progressSelected", progressM: 2_000, totalDistanceM: TOTAL_M }],
      chapters: [{ type: "replayReturned" }],
    });
    expect(sought.stage.control).toMatchObject({ playing: false, progressM: 2_000 });
    expect(sought.chapters.mode).toBe("following");
  });
});
