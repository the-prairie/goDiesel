import { describe, expect, it } from "vitest";

import { initialReplayChapterControlsState, reduceReplayChapterControls, type ReplayChapterControlsEvent } from "./replay-chapter-controls-state";
import type { ReplayChapter, ReplayMoment } from "./replay-chapter-model";

const chapter: ReplayChapter = { id: "chapter-2", index: 1, label: "Rolling", startM: 1_000, endM: 2_000, ascentM: 25, descentM: 30 };
const moment: ReplayMoment = { id: "high", kind: "high-point", label: "High point", startM: 1_200, endM: 1_800, anchorM: 1_500, valueM: 50, explanation: "Highest recorded elevation sample." };
const selectChapter = { type: "chapterSelected", chapter } as const;
const selectMoment = { type: "momentSelected", moment } as const;
const move = (progressM: number): ReplayChapterControlsEvent => ({ type: "previewMoved", progressM, totalDistanceM: 4_000 });
const scope = (value: "lens" | "whole"): ReplayChapterControlsEvent => ({ type: "scopeChanged", scope: value, totalDistanceM: 4_000 });
const run = (...events: ReplayChapterControlsEvent[]) => events.reduce(reduceReplayChapterControls, initialReplayChapterControlsState());

describe("Replay chapter browsing", () => {
  it("follows the real session without storing a second replay position", () => {
    expect(initialReplayChapterControlsState()).toEqual({ mode: "following", scope: "lens" });
  });

  it("opens chapters at their start and moments at their recorded anchor", () => {
    expect(run(selectChapter)).toMatchObject({ mode: "preview", scope: "lens", progressM: 1_000, target: { kind: "chapter", chapter } });
    expect(run(selectChapter, move(1_900), selectMoment)).toMatchObject({ mode: "preview", scope: "lens", progressM: 1_500, target: { kind: "moment", moment } });
  });

  it("constrains preview movement to the lens while leaving session IO to the adapter", () => {
    expect(run(selectChapter, move(-1))).toMatchObject({ progressM: 1_000 });
    expect(run(selectMoment, move(3_000))).toMatchObject({ progressM: 1_800 });
  });

  it("allows whole-route preview and brings it back into the selected lens", () => {
    expect(run(selectMoment, scope("whole"), move(3_500))).toMatchObject({ scope: "whole", progressM: 3_500 });
    expect(run(selectMoment, scope("whole"), move(5_000))).toMatchObject({ progressM: 4_000 });
    expect(run(selectMoment, scope("whole"), move(3_500), scope("lens"))).toMatchObject({ scope: "lens", progressM: 1_800 });
  });

  it("returns to following without retaining or committing the preview position", () => {
    expect(run(selectMoment, move(1_700), { type: "replayReturned" })).toEqual(initialReplayChapterControlsState());
  });

  it("resets the selection and scope on route replacement", () => {
    expect(run(selectMoment, scope("whole"), { type: "routeReplaced" })).toEqual(initialReplayChapterControlsState());
  });

  it("ignores movement without a preview and invalid values", () => {
    const following = initialReplayChapterControlsState();
    expect(reduceReplayChapterControls(following, move(500))).toBe(following);
    expect(reduceReplayChapterControls(following, { type: "replayReturned" })).toBe(following);
    const preview = run(selectMoment);
    expect(reduceReplayChapterControls(preview, move(Number.NaN))).toBe(preview);
    expect(reduceReplayChapterControls(preview, scope("lens"))).toBe(preview);
  });

  it("does not mutate a selected chapter or earlier state", () => {
    const initial = Object.freeze(initialReplayChapterControlsState());
    const selected = reduceReplayChapterControls(initial, { type: "chapterSelected", chapter: Object.freeze(chapter) });
    expect(reduceReplayChapterControls(selected, move(1_250))).toMatchObject({ progressM: 1_250 });
    expect(selected).toMatchObject({ progressM: 1_000 });
    expect(initial).toEqual({ mode: "following", scope: "lens" });
  });
});
