// Placing and swapping her moments, in the sketch world's review mode. The
// writer (ADR-0010, loopback only) is checked first: without it, a tap says
// placing works on the laptop. With it: tap a building to place a catalog
// entry on its street-facing side (or the side she turns to); tap a placed
// moment to swap it or remove it. A save shows at once and keeps what she had
// if it fails.

import { placeMoment, removePlacement, swapPlacement, type MomentsData } from "@/labs/sketch/moment-catalog";
import type { Front } from "@/labs/sketch/moment-place";

export type AssignState =
  | { phase: "checking" }
  | { phase: "ready"; writer: boolean }
  | { phase: "blocked" }
  | { phase: "placing"; fronts: Front[]; front: number }
  | { phase: "editing"; placementId: string }
  | { phase: "saving"; previous: MomentsData; next: MomentsData }
  | { phase: "failed"; message: string; kept: MomentsData };

export type AssignEvent =
  | { type: "writerChecked"; available: boolean }
  | { type: "buildingTapped"; fronts: Front[] }
  | { type: "placementTapped"; id: string }
  | { type: "turned" }
  | { type: "entryChosen"; entryId: string; id: string; data: MomentsData }
  | { type: "swapChosen"; entryId: string; data: MomentsData }
  | { type: "removeRequested"; data: MomentsData }
  | { type: "cancelled" }
  | { type: "saved" }
  | { type: "saveFailed"; message: string }
  | { type: "dismissed" };

export function initialAssignState(): AssignState {
  return { phase: "checking" };
}

const saving = (previous: MomentsData, next: MomentsData): AssignState => ({ phase: "saving", previous, next });

export function reduceAssign(state: AssignState, event: AssignEvent): AssignState {
  switch (state.phase) {
    case "checking":
      return event.type === "writerChecked" ? { phase: "ready", writer: event.available } : state;
    case "ready":
      if (event.type === "writerChecked") return { phase: "ready", writer: event.available };
      if (event.type === "buildingTapped" || event.type === "placementTapped") {
        if (!state.writer) return { phase: "blocked" };
        if (event.type === "placementTapped") return { phase: "editing", placementId: event.id };
        return event.fronts.length ? { phase: "placing", fronts: event.fronts, front: 0 } : state;
      }
      return state;
    case "blocked":
      return event.type === "dismissed" || event.type === "cancelled" ? { phase: "ready", writer: false } : state;
    case "placing":
      if (event.type === "turned") return { ...state, front: (state.front + 1) % state.fronts.length };
      if (event.type === "entryChosen") {
        const { at, facingDeg, frontM } = state.fronts[state.front];
        return saving(event.data, placeMoment(event.data, { id: event.id, entryId: event.entryId, at, facingDeg, frontM }));
      }
      return event.type === "cancelled" ? { phase: "ready", writer: true } : state;
    case "editing":
      if (event.type === "swapChosen") return saving(event.data, swapPlacement(event.data, state.placementId, event.entryId));
      if (event.type === "removeRequested") return saving(event.data, removePlacement(event.data, state.placementId));
      return event.type === "cancelled" ? { phase: "ready", writer: true } : state;
    case "saving":
      if (event.type === "saved") return { phase: "ready", writer: true };
      if (event.type === "saveFailed") return { phase: "failed", message: event.message, kept: state.previous };
      return state;
    case "failed":
      return event.type === "dismissed" || event.type === "cancelled" ? { phase: "ready", writer: true } : state;
  }
}
