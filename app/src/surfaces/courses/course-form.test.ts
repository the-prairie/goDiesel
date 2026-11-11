import { describe, expect, it } from "vitest";
import { generateHint, placeReducer } from "./course-form";

const park = { name: "Golden Gate Park", lat: 37.7694, lng: -122.4862 };

describe("course starting-place selection", () => {
  it("requires a choice and clears it when the query changes", () => {
    const pending = placeReducer({ status: "idle" }, { type: "search", id: 1 });
    const choices = placeReducer(pending, {
      type: "results",
      id: 1,
      places: [park],
    });
    expect(choices.status).toBe("choices");
    const chosen = placeReducer(choices, { type: "choose", place: park });
    expect(chosen).toEqual({ status: "chosen", place: park });
    expect(placeReducer(chosen, { type: "edit" })).toEqual({ status: "idle" });
  });

  it("ignores results for a query the person has edited", () => {
    const pending = placeReducer({ status: "idle" }, { type: "search", id: 1 });
    const edited = placeReducer(pending, { type: "edit" });
    expect(
      placeReducer(edited, { type: "results", id: 1, places: [park] }),
    ).toBe(edited);
  });

  it("ignores a late error from the previous search", () => {
    const first = placeReducer({ status: "idle" }, { type: "search", id: 1 });
    const second = placeReducer(first, { type: "search", id: 2 });
    expect(
      placeReducer(second, { type: "error", id: 1, message: "Timeout" }),
    ).toBe(second);
    expect(
      placeReducer(second, { type: "results", id: 2, places: [park] }).status,
    ).toBe("choices");
  });

  it("allows a new search after an empty result without inventing a start", () => {
    const pending = placeReducer({ status: "idle" }, { type: "search", id: 1 });
    const empty = placeReducer(pending, { type: "results", id: 1, places: [] });
    expect(empty.status).toBe("error");
    const retried = placeReducer(empty, { type: "search", id: 2 });
    const choices = placeReducer(retried, {
      type: "results",
      id: 2,
      places: [park],
    });
    expect(choices).toEqual({ status: "choices", places: [park] });
  });
});

describe("why Generate route is unavailable", () => {
  const ready = {
    query: "Golden Gate Park",
    place: { status: "chosen", place: park } as const,
    distance: "10",
    unit: "km" as const,
  };

  it("has no hint once a place is chosen and the distance is valid", () => {
    expect(generateHint(ready)).toBeUndefined();
  });

  it("asks for a place before anything else", () => {
    expect(
      generateHint({ ...ready, query: " ", place: { status: "idle" }, distance: "" }),
    ).toBe("Enter a starting place, then choose it from the results.");
  });

  it("asks for a typed place to be chosen from the results", () => {
    expect(generateHint({ ...ready, place: { status: "idle" } })).toBe(
      "Search for this place, then choose it from the results.",
    );
    expect(
      generateHint({ ...ready, place: { status: "searching", id: 1 } }),
    ).toBe("Finding places. Choose one from the results to continue.");
    expect(
      generateHint({ ...ready, place: { status: "choices", places: [park] } }),
    ).toBe("Choose a starting place from the results.");
    expect(
      generateHint({ ...ready, place: { status: "error", message: "Down" } }),
    ).toBe("Search again, then choose a starting place.");
  });

  it("names the distance range in the selected unit", () => {
    for (const distance of ["", "0", "101", "abc"])
      expect(generateHint({ ...ready, distance })).toBe(
        "Enter a distance between 1 and 100 km.",
      );
    expect(generateHint({ ...ready, unit: "mi", distance: "0.5" })).toBe(
      "Enter a distance between 0.63 and 62.13 mi.",
    );
    expect(generateHint({ ...ready, unit: "mi", distance: "62.13" })).toBeUndefined();
  });
});
