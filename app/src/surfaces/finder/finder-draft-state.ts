import type { FinderIntent } from "@/domain/planning";

/**
 * The Finder form's editable draft. The submitted intent lives in the URL
 * (ADR-0016); the draft may differ from it until the next search. A stored
 * draft belongs to the submission it was edited against, named by `baseKey`.
 * `draft: null` means the form shows the submission itself.
 */
export type FinderDraftState = { baseKey: string; draft: FinderIntent | null };

export type FinderDraftEvent =
  | { type: "edited"; base: FinderIntent | null; draft: FinderIntent }
  | { type: "submitted" }
  | { type: "submissionChanged"; submitted: FinderIntent | null };

export function paramsForIntent(intent: FinderIntent) {
  const params = new URLSearchParams({
    place: intent.place.trim(),
    activity: intent.activity,
    distance: String(intent.distanceKm),
  });
  if (intent.explicitFilters) params.set("filters", intent.explicitFilters.join(","));
  if (intent.query) params.set("q", intent.query);
  if (intent.minDistanceKm != null) params.set("min", String(intent.minDistanceKm));
  if (intent.maxDistanceKm != null) params.set("max", String(intent.maxDistanceKm));
  if (intent.maxElevationM != null) params.set("climb", String(intent.maxElevationM));
  if (intent.similarPlace) params.set("like", intent.similarPlace);
  if (intent.terrain !== "any") params.set("terrain", intent.terrain);
  if (intent.vibe.trim()) params.set("vibe", intent.vibe.trim());
  return params;
}

/** Stable identity of a submission. Unrelated URL params (`selected`, `scope`, `near`) never reach it. */
export function submittedIntentKey(submitted: FinderIntent | null) {
  return submitted ? paramsForIntent(submitted).toString() : "";
}

export function initialFinderDraftState(submitted: FinderIntent | null): FinderDraftState {
  return { baseKey: submittedIntentKey(submitted), draft: null };
}

export function reduceFinderDraft(state: FinderDraftState, event: FinderDraftEvent): FinderDraftState {
  switch (event.type) {
    case "edited":
      return { baseKey: submittedIntentKey(event.base), draft: event.draft };
    case "submitted":
      return state.draft ? { ...state, draft: null } : state;
    case "submissionChanged": {
      const baseKey = submittedIntentKey(event.submitted);
      return baseKey === state.baseKey ? state : { baseKey, draft: null };
    }
  }
}

/** The intent the form shows: the stored draft only while it belongs to the current submission. */
export function visibleDraft(state: FinderDraftState, submitted: FinderIntent | null, fallback: FinderIntent): FinderIntent {
  if (state.draft && state.baseKey === submittedIntentKey(submitted)) return state.draft;
  return submitted ?? fallback;
}
