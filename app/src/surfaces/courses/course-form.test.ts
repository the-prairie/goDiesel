import { describe, expect, it } from "vitest";
import { placeReducer } from "./course-form";

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
