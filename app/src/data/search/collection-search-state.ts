import type { SearchDocument } from "@/domain/search/ranking";

type SearchOperation = { key: string; requestId: number };
type IndexedSearch = SearchOperation & { docs: SearchDocument[] };

export type CollectionSearchState =
  | { phase: "idle" }
  | (SearchOperation & { phase: "loadingIndex" | "basicFallback" })
  | (IndexedSearch & { phase: "keywordReady" | "embedding" })
  | (IndexedSearch & { phase: "semanticReady" | "keywordFallback"; vector?: number[] });

export type CollectionSearchEvent =
  | (SearchOperation & { type: "searchStarted" })
  | { type: "indexReceived"; requestId: number; docs: SearchDocument[]; refine: boolean }
  | { type: "indexFailed"; requestId: number }
  | { type: "embeddingReceived"; requestId: number; vector?: number[]; failed: boolean }
  | { type: "embeddingFailed"; requestId: number };

export function initialCollectionSearchState(): CollectionSearchState {
  return { phase: "idle" };
}

export function reduceCollectionSearch(state: CollectionSearchState, event: CollectionSearchEvent): CollectionSearchState {
  if (event.type === "searchStarted") {
    return { phase: "loadingIndex", key: event.key, requestId: event.requestId };
  }
  if (state.phase === "idle" || event.requestId !== state.requestId) return state;
  switch (event.type) {
    case "indexReceived":
      return state.phase === "loadingIndex"
        ? { ...state, phase: event.refine ? "embedding" : "keywordReady", docs: event.docs }
        : state;
    case "indexFailed":
      return state.phase === "loadingIndex" || state.phase === "embedding"
        ? { phase: "basicFallback", key: state.key, requestId: state.requestId }
        : state;
    case "embeddingReceived":
      return state.phase === "embedding"
        ? { ...state, phase: event.failed ? "keywordFallback" : "semanticReady", vector: event.vector }
        : state;
    case "embeddingFailed":
      return state.phase === "embedding" ? { ...state, phase: "keywordFallback" } : state;
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled collection search event: ${unhandled}`);
    }
  }
}

export function selectCollectionSearch(state: CollectionSearchState, key: string) {
  if (state.phase === "idle" || state.key !== key) {
    return { docs: [], vector: undefined, mode: "Searching guides…", limited: false };
  }
  const mode = {
    loadingIndex: "Searching guides…",
    basicFallback: "Basic search · full guide index unavailable",
    keywordReady: "Keyword search",
    embedding: "Finding related guide themes…",
    semanticReady: "Keyword + related-theme search",
    keywordFallback: "Keyword search · related-theme search unavailable",
  }[state.phase];
  return {
    docs: "docs" in state ? state.docs : [],
    vector: "vector" in state ? state.vector : undefined,
    mode,
    limited: state.phase === "basicFallback" || state.phase === "keywordFallback",
  };
}
