import { describe, expect, it } from "vitest";

import { initialAssignState, reduceAssign, type AssignEvent, type AssignState } from "@/labs/sketch/moment-assign-state";
import type { MomentsData } from "@/labs/sketch/moment-catalog";

const data: MomentsData = {
  catalog: [
    { id: "a", kind: "tv-wall", title: "A", clip: null },
    { id: "b", kind: "tv-wall", title: "B", clip: null },
  ],
  placements: [{ id: "p1", entryId: "a", at: { lng: 1, lat: 1 }, facingDeg: 0 }],
};
const fronts = [
  { at: { lng: 2, lat: 2 }, facingDeg: 180, frontM: 12 },
  { at: { lng: 3, lat: 3 }, facingDeg: 90, frontM: 8 },
];
const run = (events: AssignEvent[], state: AssignState = initialAssignState()) => events.reduce(reduceAssign, state);
const ready = run([{ type: "writerChecked", available: true }]);

describe("placing and swapping moments in review mode", () => {
  it("says placing works on the laptop when the writer cannot be reached, rather than failing silently", () => {
    const away = run([{ type: "writerChecked", available: false }]);
    expect(run([{ type: "buildingTapped", fronts }], away)).toEqual({ phase: "blocked" });
    expect(run([{ type: "placementTapped", id: "p1" }], away)).toEqual({ phase: "blocked" });
    expect(run([{ type: "buildingTapped", fronts }, { type: "dismissed" }], away)).toEqual({ phase: "ready", writer: false });
  });

  it("places a catalog entry on the street-facing side of a tapped building, or the side she turns to", () => {
    const placing = run([{ type: "buildingTapped", fronts }], ready);
    expect(placing).toMatchObject({ phase: "placing", front: 0 });
    const turned = run([{ type: "turned" }], placing);
    expect(turned).toMatchObject({ front: 1 });
    expect(run([{ type: "turned" }, { type: "turned" }], placing)).toMatchObject({ front: 0 });
    const saving = run([{ type: "entryChosen", entryId: "b", id: "new-1", data }], turned);
    expect(saving).toMatchObject({ phase: "saving", previous: data });
    if (saving.phase !== "saving") throw new Error();
    expect(saving.next.placements.at(-1)).toEqual({ id: "new-1", entryId: "b", at: { lng: 3, lat: 3 }, facingDeg: 90, frontM: 8 });
  });

  it("ignores a tap where there is no building", () => {
    expect(run([{ type: "buildingTapped", fronts: [] }], ready)).toBe(ready);
  });

  it("swaps or removes a placed moment", () => {
    const editing = run([{ type: "placementTapped", id: "p1" }], ready);
    expect(editing).toEqual({ phase: "editing", placementId: "p1" });
    const swapped = run([{ type: "swapChosen", entryId: "b", data }], editing);
    expect(swapped.phase === "saving" && swapped.next.placements[0].entryId).toBe("b");
    const removed = run([{ type: "removeRequested", data }], editing);
    expect(removed.phase === "saving" && removed.next.placements).toEqual([]);
  });

  it("keeps what she had when a save fails, and says so; settles when it succeeds", () => {
    const saving = run([{ type: "placementTapped", id: "p1" }, { type: "removeRequested", data }], ready);
    expect(run([{ type: "saved" }], saving)).toEqual({ phase: "ready", writer: true });
    const failed = run([{ type: "saveFailed", message: "busy" }], saving);
    expect(failed).toEqual({ phase: "failed", message: "busy", kept: data });
    expect(run([{ type: "dismissed" }], failed)).toEqual({ phase: "ready", writer: true });
  });

  it("cancels back to ready, and does not start a second save during one", () => {
    expect(run([{ type: "buildingTapped", fronts }, { type: "cancelled" }], ready)).toEqual({ phase: "ready", writer: true });
    const saving = run([{ type: "placementTapped", id: "p1" }, { type: "removeRequested", data }], ready);
    expect(run([{ type: "buildingTapped", fronts }], saving)).toBe(saving);
  });
});
