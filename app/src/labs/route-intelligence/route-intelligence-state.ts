import type { QuestRoute } from "@/domain/route";
import type { RouteGenome } from "@/labs/route-intelligence/route-genome";

export interface LabRoute {
  route: QuestRoute;
  genome: RouteGenome;
}

type LoadedRoutes = [LabRoute, ...LabRoute[]];

export type RouteIntelligenceState =
  | { status: "loading" }
  | { status: "complete" | "partial"; routes: LoadedRoutes }
  | { status: "empty" | "failed" };

export type RouteIntelligenceEvent = {
  type: "routesSettled";
  routes: LabRoute[];
  expectedCount: number;
  hasRequestFailure: boolean;
};

export function initialRouteIntelligenceState(): RouteIntelligenceState {
  return { status: "loading" };
}

export function reduceRouteIntelligence(
  state: RouteIntelligenceState,
  event: RouteIntelligenceEvent,
): RouteIntelligenceState {
  if (state.status !== "loading") return state;
  switch (event.type) {
    case "routesSettled": {
      const [first, ...rest] = event.routes;
      if (!first) return { status: event.hasRequestFailure ? "failed" : "empty" };
      return {
        status: event.routes.length === event.expectedCount ? "complete" : "partial",
        routes: [first, ...rest],
      };
    }
  }
}

export function selectedRouteIntelligenceEntry(
  state: RouteIntelligenceState,
  preferredId: string,
): LabRoute | undefined {
  if (!("routes" in state)) return undefined;
  return state.routes.find(({ route }) => route.activityId === preferredId) ?? state.routes[0];
}
