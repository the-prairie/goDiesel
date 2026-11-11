import { describe, expect, it } from "vitest";
import type { FinderIntent } from "@/domain/planning";
import {
  initialFinderDraftState,
  reduceFinderDraft,
  submittedIntentKey,
  visibleDraft,
  type FinderDraftState,
} from "./finder-draft-state";

const fallback: FinderIntent = { place: "", activity: "Run", distanceKm: 0, explicitFilters: [], terrain: "any", vibe: "" };
const kyoto: FinderIntent = { ...fallback, place: "Kyoto", distanceKm: 21, explicitFilters: ["place", "distanceKm"] };
const lisbon: FinderIntent = { ...fallback, place: "Lisbon", distanceKm: 10, explicitFilters: ["place", "distanceKm"] };
const edited: FinderIntent = { ...kyoto, distanceKm: 30 };

describe("submittedIntentKey", () => {
  it("serialises only the submitted intent", () => {
    expect(submittedIntentKey(kyoto)).toBe(submittedIntentKey({ ...kyoto }));
    expect(submittedIntentKey(kyoto)).not.toBe(submittedIntentKey(lisbon));
  });

  it("gives no submission a key distinct from every intent", () => {
    expect(submittedIntentKey(null)).toBe("");
    expect(submittedIntentKey(fallback)).not.toBe("");
  });
});

describe("visibleDraft", () => {
  it("shows the fallback intent before any submission", () => {
    expect(visibleDraft(initialFinderDraftState(null), null, fallback)).toBe(fallback);
  });

  it("shows the submitted intent when nothing was edited", () => {
    expect(visibleDraft(initialFinderDraftState(kyoto), kyoto, fallback)).toBe(kyoto);
  });

  it("shows an edit made against the current submission", () => {
    const state = reduceFinderDraft(initialFinderDraftState(kyoto), { type: "edited", base: kyoto, draft: edited });
    expect(visibleDraft(state, kyoto, fallback)).toBe(edited);
  });

  it("keeps the edit when an equal submission is re-parsed (selected, scope or near changed)", () => {
    const state = reduceFinderDraft(initialFinderDraftState(kyoto), { type: "edited", base: kyoto, draft: edited });
    expect(visibleDraft(state, { ...kyoto, explicitFilters: [...kyoto.explicitFilters!] }, fallback)).toBe(edited);
  });

  it("shows a different submission instead of an edit made against another one", () => {
    const state = reduceFinderDraft(initialFinderDraftState(kyoto), { type: "edited", base: kyoto, draft: edited });
    expect(visibleDraft(state, lisbon, fallback)).toBe(lisbon);
    expect(visibleDraft(state, null, fallback)).toBe(fallback);
  });

  it("keeps an edit made before the first submission until one exists", () => {
    const draft = { ...fallback, distanceKm: 5 };
    const state = reduceFinderDraft(initialFinderDraftState(null), { type: "edited", base: null, draft });
    expect(visibleDraft(state, null, fallback)).toBe(draft);
    expect(visibleDraft(state, kyoto, fallback)).toBe(kyoto);
  });
});

describe("reduceFinderDraft", () => {
  const editedState = reduceFinderDraft(initialFinderDraftState(kyoto), { type: "edited", base: kyoto, draft: edited });

  it("starts with no stored draft on the given submission", () => {
    expect(initialFinderDraftState(kyoto)).toEqual({ baseKey: submittedIntentKey(kyoto), draft: null });
  });

  it("drops the stored draft on submit, even when the submission is unchanged", () => {
    const state = reduceFinderDraft(editedState, { type: "submitted" });
    expect(state.draft).toBeNull();
    expect(visibleDraft(state, kyoto, fallback)).toBe(kyoto);
  });

  it("returns the same state for a submit with nothing stored", () => {
    const state = initialFinderDraftState(kyoto);
    expect(reduceFinderDraft(state, { type: "submitted" })).toBe(state);
  });

  it("forgets a draft once the submission moves away, so returning does not resurrect it", () => {
    const moved = reduceFinderDraft(editedState, { type: "submissionChanged", submitted: lisbon });
    expect(moved).toEqual({ baseKey: submittedIntentKey(lisbon), draft: null });
    expect(visibleDraft(moved, kyoto, fallback)).toBe(kyoto);
  });

  it("returns the same state when the submission key is unchanged", () => {
    expect(reduceFinderDraft(editedState, { type: "submissionChanged", submitted: { ...kyoto } })).toBe(editedState);
  });

  it("replaces the stored draft on each edit", () => {
    const next = { ...edited, terrain: "trail" as const };
    const state: FinderDraftState = reduceFinderDraft(editedState, { type: "edited", base: kyoto, draft: next });
    expect(visibleDraft(state, kyoto, fallback)).toBe(next);
  });
});
