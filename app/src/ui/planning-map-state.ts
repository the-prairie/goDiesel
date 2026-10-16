export type PlanningMapState = {
  operationId: number;
  errorCount: number;
} & (
  | { status: "loading" | "ready" }
  | { status: "unavailable"; reason: "deadline" | "errors" }
);

export type PlanningMapEvent =
  | { type: "mapStarted"; operationId: number }
  | { type: "mapError"; operationId: number; loaded: boolean }
  | { type: "deadlineReached"; operationId: number; loaded: boolean }
  | { type: "mapIdle"; operationId: number };

export function initialPlanningMapState(operationId = 0): PlanningMapState {
  return { status: "loading", operationId, errorCount: 0 };
}

export function reducePlanningMap(state: PlanningMapState, event: PlanningMapEvent): PlanningMapState {
  if (event.type === "mapStarted") {
    return event.operationId > state.operationId ? initialPlanningMapState(event.operationId) : state;
  }
  if (event.operationId !== state.operationId) return state;

  switch (event.type) {
    case "mapError": {
      const errorCount = Math.min(state.errorCount + 1, 4);
      return errorCount >= 4 && !event.loaded
        ? { status: "unavailable", operationId: state.operationId, errorCount, reason: "errors" }
        : { ...state, errorCount };
    }
    case "deadlineReached":
      return event.loaded ? state : { ...state, status: "unavailable", reason: "deadline" };
    case "mapIdle":
      return { status: "ready", operationId: state.operationId, errorCount: state.errorCount };
  }
}
