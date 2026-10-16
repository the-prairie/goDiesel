type RankingOperation = { key: string; requestId: number };

export type ExternalRankingState =
  | { phase: "idle" }
  | (RankingOperation & { phase: "embedding" })
  | (RankingOperation & { phase: "semanticReady" | "keywordFallback"; vectors?: number[][] });

export type ExternalRankingEvent =
  | (RankingOperation & { type: "rankingStarted" })
  | { type: "embeddingReceived"; requestId: number; vectors?: number[][]; failed: boolean }
  | { type: "embeddingFailed"; requestId: number };

export function initialExternalRankingState(): ExternalRankingState {
  return { phase: "idle" };
}

export function reduceExternalRanking(state: ExternalRankingState, event: ExternalRankingEvent): ExternalRankingState {
  if (event.type === "rankingStarted") {
    return { phase: "embedding", key: event.key, requestId: event.requestId };
  }
  if (state.phase !== "embedding" || state.requestId !== event.requestId) return state;
  switch (event.type) {
    case "embeddingReceived":
      return { ...state, phase: event.failed ? "keywordFallback" : "semanticReady", vectors: event.vectors };
    case "embeddingFailed":
      return { ...state, phase: "keywordFallback" };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled external ranking event: ${unhandled}`);
    }
  }
}

export function selectExternalRanking(state: ExternalRankingState, key: string, enabled: boolean) {
  if (!enabled) return { vectors: undefined, mode: "", limited: false };
  if (state.phase === "idle" || state.key !== key) {
    return { vectors: undefined, mode: "Ranking matches…", limited: false };
  }
  return {
    vectors: "vectors" in state ? state.vectors : undefined,
    mode: {
      embedding: "Refining matches…",
      semanticReady: "Keyword + related-theme ranking",
      keywordFallback: "Keyword ranking · related-theme search unavailable",
    }[state.phase],
    limited: state.phase === "keywordFallback",
  };
}
