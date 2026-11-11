import type { ReplayChapter, ReplayMoment, ReplaySpan } from "./replay-chapter-model";

type ReplayPreviewTarget =
  | { kind: "chapter"; chapter: ReplayChapter }
  | { kind: "moment"; moment: ReplayMoment };

export type ReplayChapterControlsState =
  | { mode: "following"; scope: "lens" | "whole" }
  | { mode: "preview"; scope: "lens" | "whole"; target: ReplayPreviewTarget; progressM: number };

export type ReplayChapterControlsEvent =
  | { type: "chapterSelected"; chapter: ReplayChapter }
  | { type: "momentSelected"; moment: ReplayMoment }
  | { type: "previewMoved"; progressM: number; totalDistanceM: number }
  | { type: "scopeChanged"; scope: "lens" | "whole"; totalDistanceM: number }
  | { type: "replayReturned" }
  | { type: "routeReplaced" };

export function initialReplayChapterControlsState(): ReplayChapterControlsState {
  return { mode: "following", scope: "lens" };
}

export function replayPreviewSpan(state: Extract<ReplayChapterControlsState, { mode: "preview" }>): ReplaySpan {
  return state.target.kind === "chapter" ? state.target.chapter : state.target.moment;
}

export function reduceReplayChapterControls(
  state: ReplayChapterControlsState,
  event: ReplayChapterControlsEvent,
): ReplayChapterControlsState {
  switch (event.type) {
    case "chapterSelected":
      return { mode: "preview", scope: "lens", target: { kind: "chapter", chapter: event.chapter }, progressM: event.chapter.startM };
    case "momentSelected":
      return { mode: "preview", scope: "lens", target: { kind: "moment", moment: event.moment }, progressM: event.moment.anchorM };
    case "previewMoved": {
      if (state.mode !== "preview" || !Number.isFinite(event.progressM)) return state;
      const span = state.scope === "whole" ? { startM: 0, endM: event.totalDistanceM } : replayPreviewSpan(state);
      return { ...state, progressM: Math.max(span.startM, Math.min(span.endM, event.progressM)) };
    }
    case "scopeChanged": {
      if (state.scope === event.scope) return state;
      const next = { ...state, scope: event.scope };
      if (next.mode !== "preview") return next;
      return reduceReplayChapterControls(next, { type: "previewMoved", progressM: next.progressM, totalDistanceM: event.totalDistanceM });
    }
    case "replayReturned":
      return state.mode === "following" ? state : { mode: "following", scope: "lens" };
    case "routeReplaced":
      return initialReplayChapterControlsState();
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Replay chapter controls event: ${unhandled}`);
    }
  }
}
