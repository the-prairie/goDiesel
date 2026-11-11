import { describe, expect, it } from "vitest";
import type { DiscoveryPlace, ExternalRoute } from "@/domain/search/external";
import {
  discoveryMessage,
  initialDiscoveryState,
  reduceDiscovery,
  type DiscoveryEvent,
  type DiscoveryState,
} from "./discovery-state";

const place: DiscoveryPlace = { name: "Springfield, Illinois", lat: 39.8, lng: -89.6 };
const submission = { id: 1, destination: "Springfield", activity: "Run" as const };
const route: ExternalRoute = {
  id: "osm-123",
  name: "River path",
  sourceUrl: "https://www.openstreetmap.org/relation/123",
  activity: "Run",
  distanceKm: 4,
  distanceKind: "mapped",
  lines: [[[0, 50], [0.01, 50]]],
};

function run(...events: DiscoveryEvent[]) {
  return events.reduce(reduceDiscovery, initialDiscoveryState("Springfield"));
}

const start: DiscoveryEvent = { type: "searchStarted", submission };
const startRoutes: DiscoveryEvent = { ...start, place };
const results: DiscoveryEvent = { type: "routesReceived", requestId: 1, routes: [route] };

describe("discovery transitions", () => {
  it("starts idle with the supplied destination and ignores a blank search", () => {
    const initial = initialDiscoveryState("  ");
    expect(initial).toEqual({ destination: "  ", view: "list", request: { phase: "idle" } });
    expect(reduceDiscovery(initial, {
      type: "searchStarted", submission: { ...submission, destination: "  " },
    })).toBe(initial);
    expect(discoveryMessage(initial.request)).toBe("");
  });

  it("requires a place choice even when only one place is returned", () => {
    const state = run(start, { type: "placesReceived", requestId: 1, places: [place] });
    expect(state.request).toEqual({ phase: "choosing-place", places: [place] });
    expect(discoveryMessage(state.request)).toBe("Choose the place you mean.");
  });

  it("loads a known or chosen place directly with its submission snapshot", () => {
    const state = run(startRoutes);
    expect(state.request).toEqual({ phase: "loading-routes", submission, place });
    expect(discoveryMessage(state.request)).toBe("Looking for mapped routes…");
  });

  it("keeps the pending submission when the draft destination changes", () => {
    const state = run(start, { type: "destinationEdited", destination: "Other town" });
    expect(state.destination).toBe("Other town");
    expect(state.request).toEqual({ phase: "resolving-place", submission });
    const received = reduceDiscovery(state, { type: "placesReceived", requestId: 1, places: [place] });
    expect(received.request.phase).toBe("choosing-place");
    expect(received.destination).toBe("Other town");
  });

  it("clears choices on edit while retaining the choice prompt", () => {
    const state = run(start,
      { type: "placesReceived", requestId: 1, places: [place] },
      { type: "destinationEdited", destination: "Other town" });
    expect(state.request).toEqual({ phase: "choosing-place", places: [] });
    expect(discoveryMessage(state.request)).toBe("Choose the place you mean.");
  });

  it("distinguishes no places from a successful empty route response", () => {
    const noPlaces = run(start, { type: "placesReceived", requestId: 1, places: [] });
    const noRoutes = run(startRoutes, { type: "routesReceived", requestId: 1, routes: [] });
    expect(noPlaces.request).toEqual({ phase: "no-places" });
    expect(discoveryMessage(noPlaces.request)).toBe("No places found. Try a town or region name.");
    expect(noRoutes.request).toEqual({ phase: "results", place, routes: [] });
    expect(discoveryMessage(noRoutes.request)).toBe("");
  });

  it("retains results and selection while the destination is edited", () => {
    const state = run(startRoutes, results,
      { type: "candidateSelected", id: route.id },
      { type: "destinationEdited", destination: "Other town" });
    expect(state.request).toEqual({ phase: "results", place, routes: [route] });
    expect(state.selected).toBe(route.id);
    expect(state.view).toBe("map");
  });

  it("returns to the list on search but clears selection only on route success", () => {
    const selected = run(startRoutes, results, { type: "candidateSelected", id: route.id });
    const searching = reduceDiscovery(selected, {
      type: "searchStarted", submission: { ...submission, id: 2 }, place,
    });
    expect(searching.view).toBe("list");
    expect(searching.selected).toBe(route.id);
    expect(searching.request.phase).toBe("loading-routes");
    expect(reduceDiscovery(searching, { ...results, requestId: 2 }).selected).toBeUndefined();
  });

  it.each([start, startRoutes])("retains the failure stage and retries with a new snapshot for $type", (event) => {
    const failed = run(event, { type: "requestFailed", requestId: 1, message: "Upstream unavailable" });
    expect(failed.request).toEqual({
      phase: "failed", stage: "place" in event ? "loading-routes" : "resolving-place", message: "Upstream unavailable",
    });
    expect(discoveryMessage(failed.request)).toBe("Upstream unavailable");
    const edited = reduceDiscovery(failed, { type: "destinationEdited", destination: "New destination" });
    expect(edited.request).toBe(failed.request);
    const retried = reduceDiscovery(edited, {
      type: "searchStarted", submission: { ...submission, id: 2, destination: edited.destination },
    });
    expect(retried.request).toEqual({
      phase: "resolving-place", submission: { ...submission, id: 2, destination: "New destination" },
    });
  });

  it.each<DiscoveryEvent>([
    { type: "placesReceived", requestId: 1, places: [place] },
    results,
    { type: "requestFailed", requestId: 1, message: "Old failure" },
  ])("ignores a superseded $type completion", (completion) => {
    const state = run(start, { type: "searchStarted", submission: { ...submission, id: 2 }, place });
    expect(reduceDiscovery(state, completion)).toBe(state);
  });

  it("rejects a response for the wrong request stage", () => {
    const resolving = run(start);
    const loading = run(startRoutes);
    expect(reduceDiscovery(resolving, results)).toBe(resolving);
    expect(reduceDiscovery(loading, { type: "placesReceived", requestId: 1, places: [place] })).toBe(loading);
  });

  it.each<DiscoveryState>([
    initialDiscoveryState("Springfield"),
    run(startRoutes, results),
    run(start, { type: "placesReceived", requestId: 1, places: [place] }),
    run(start, { type: "placesReceived", requestId: 1, places: [] }),
    run(start, { type: "requestFailed", requestId: 1, message: "Unavailable" }),
  ])("ignores duplicate or late completions in $request.phase", (state) => {
    for (const event of [results, { type: "placesReceived", requestId: 1, places: [place] },
      { type: "requestFailed", requestId: 1, message: "Late failure" }] satisfies DiscoveryEvent[]) {
      expect(reduceDiscovery(state, event)).toBe(state);
    }
  });

  it("switches presentation without changing the request or selection", () => {
    const selected = run(startRoutes, results, { type: "candidateSelected", id: route.id });
    const list = reduceDiscovery(selected, { type: "viewChanged", view: "list" });
    expect(list.selected).toBe(route.id);
    expect(list.request).toBe(selected.request);
    expect(list.view).toBe("list");
  });

  it("keeps save feedback independent and retains it through searches", () => {
    const loaded = run(startRoutes, results);
    const failed = reduceDiscovery(loaded, { type: "planSaveFailed", id: route.id });
    expect(failed.request).toBe(loaded.request);
    expect(failed.saveMessage).toEqual({
      id: route.id,
      text: "Could not save. Device storage is full or unavailable. Try again after freeing space.",
    });
    const saved = reduceDiscovery(failed, { type: "planSaved", id: route.id });
    const searching = reduceDiscovery(saved, start);
    expect(searching.saveMessage).toEqual({ id: route.id, text: "Saved on this device." });
    expect(saved.request).toBe(loaded.request);
    expect(loaded.saveMessage).toBeUndefined();
  });
});
