// A planted moment, opened: tapping it remembers where she was and takes the
// camera to the shop's front (approaching); the scene then opens muted with
// its clip loading, held back under Save-Data until asked, or showing no
// signal when the entry has no clip or it fails to load. Sound is hers to
// turn on. Back or Escape leaves, and the camera returns to where she was.

export interface MomentCamera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export type MomentMedia = "held" | "loading" | "playing" | "failed";

export type MomentState =
  | { phase: "closed" }
  | { phase: "approaching"; id: string; from: MomentCamera; saveData: boolean; clip: boolean }
  | { phase: "open"; id: string; from: MomentCamera; media: MomentMedia; sound: boolean }
  | { phase: "leaving"; id: string; from: MomentCamera };

export type MomentEvent =
  | { type: "tapped"; id: string; from: MomentCamera; saveData: boolean; clip: boolean }
  | { type: "arrived" }
  | { type: "mediaReady" }
  | { type: "mediaFailed" }
  | { type: "playRequested" }
  | { type: "soundToggled" }
  | { type: "backRequested" }
  | { type: "left" };

export function initialMomentState(): MomentState {
  return { phase: "closed" };
}

export function reduceMoment(state: MomentState, event: MomentEvent): MomentState {
  switch (state.phase) {
    case "closed":
      return event.type === "tapped" ? { phase: "approaching", id: event.id, from: event.from, saveData: event.saveData, clip: event.clip } : state;
    case "approaching":
      if (event.type === "arrived") return { phase: "open", id: state.id, from: state.from, media: !state.clip ? "failed" : state.saveData ? "held" : "loading", sound: false };
      if (event.type === "backRequested") return { phase: "leaving", id: state.id, from: state.from };
      return state;
    case "open":
      switch (event.type) {
        case "mediaReady":
          return state.media === "loading" ? { ...state, media: "playing" } : state;
        case "mediaFailed":
          return state.media === "loading" || state.media === "playing" ? { ...state, media: "failed", sound: false } : state;
        case "playRequested":
          return state.media === "held" ? { ...state, media: "loading" } : state;
        case "soundToggled":
          return state.media === "playing" ? { ...state, sound: !state.sound } : state;
        case "backRequested":
          return { phase: "leaving", id: state.id, from: state.from };
        default:
          return state;
      }
    case "leaving":
      return event.type === "left" ? initialMomentState() : state;
  }
}
