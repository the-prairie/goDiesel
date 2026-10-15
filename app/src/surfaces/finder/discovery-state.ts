import type { FinderIntent } from "@/domain/planning";
import type { DiscoveryPlace, ExternalRoute } from "@/domain/search/external";

interface DiscoverySubmission {
  id: number;
  destination: string;
  activity: FinderIntent["activity"];
}

export type DiscoveryRequestState =
  | { phase: "idle" }
  | { phase: "resolving-place"; submission: DiscoverySubmission }
  | { phase: "choosing-place"; places: DiscoveryPlace[] }
  | { phase: "no-places" }
  | { phase: "loading-routes"; submission: DiscoverySubmission; place: DiscoveryPlace }
  | { phase: "results"; place: DiscoveryPlace; routes: ExternalRoute[] }
  | { phase: "failed"; stage: "resolving-place" | "loading-routes"; message: string };

export interface DiscoveryState {
  destination: string;
  request: DiscoveryRequestState;
  view: "list" | "map";
  selected?: string;
  saveMessage?: { id: string; text: string };
}

export type DiscoveryEvent =
  | { type: "destinationEdited"; destination: string }
  | { type: "searchStarted"; submission: DiscoverySubmission; place?: DiscoveryPlace }
  | { type: "placesReceived"; requestId: number; places: DiscoveryPlace[] }
  | { type: "routesReceived"; requestId: number; routes: ExternalRoute[] }
  | { type: "requestFailed"; requestId: number; message: string }
  | { type: "candidateSelected"; id: string }
  | { type: "viewChanged"; view: "list" | "map" }
  | { type: "planSaved"; id: string }
  | { type: "planSaveFailed"; id: string };

export function initialDiscoveryState(destination: string): DiscoveryState {
  return { destination, request: { phase: "idle" }, view: "list" };
}

export function reduceDiscovery(state: DiscoveryState, event: DiscoveryEvent): DiscoveryState {
  const request = state.request;
  switch (event.type) {
    case "destinationEdited":
      return {
        ...state,
        destination: event.destination,
        request: request.phase === "choosing-place" ? { ...request, places: [] } : request,
      };
    case "searchStarted":
      if (!event.place && !event.submission.destination.trim()) return state;
      return {
        ...state,
        view: "list",
        request: event.place
          ? { phase: "loading-routes", submission: event.submission, place: event.place }
          : { phase: "resolving-place", submission: event.submission },
      };
    case "placesReceived":
      if (request.phase !== "resolving-place" || request.submission.id !== event.requestId) return state;
      return {
        ...state,
        request: event.places.length
          ? { phase: "choosing-place", places: event.places }
          : { phase: "no-places" },
      };
    case "routesReceived":
      if (request.phase !== "loading-routes" || request.submission.id !== event.requestId) return state;
      return {
        ...state,
        selected: undefined,
        request: { phase: "results", place: request.place, routes: event.routes },
      };
    case "requestFailed":
      if ((request.phase !== "resolving-place" && request.phase !== "loading-routes") ||
          request.submission.id !== event.requestId) return state;
      return {
        ...state,
        request: { phase: "failed", stage: request.phase, message: event.message },
      };
    case "candidateSelected":
      return { ...state, selected: event.id, view: "map" };
    case "viewChanged":
      return { ...state, view: event.view };
    case "planSaved":
      return { ...state, saveMessage: { id: event.id, text: "Saved on this device." } };
    case "planSaveFailed":
      return {
        ...state,
        saveMessage: {
          id: event.id,
          text: "Could not save. Device storage is full or unavailable. Try again after freeing space.",
        },
      };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled discovery event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function discoveryMessage(request: DiscoveryRequestState): string {
  switch (request.phase) {
    case "idle":
    case "results":
      return "";
    case "resolving-place":
    case "loading-routes":
      return "Looking for mapped routes…";
    case "choosing-place":
      return "Choose the place you mean.";
    case "no-places":
      return "No places found. Try a town or region name.";
    case "failed":
      return request.message;
  }
}
