import { useEffect, useReducer, useRef } from "react";
import type { ExternalRoute } from "@/domain/search/external";
import {
  externalSearchText,
  rankExternalRoutes,
} from "@/domain/search/external-ranking";
import { initialExternalRankingState, reduceExternalRanking, selectExternalRanking } from "./external-ranking-state";
export function useExternalRanking(routes: ExternalRoute[], query: string) {
  const key = JSON.stringify([
    query,
    routes.map((r) => [r.id, externalSearchText(r)]),
  ]);
  const [state, dispatch] = useReducer(reduceExternalRanking, undefined, initialExternalRankingState);
  const sequence = useRef(0);
  useEffect(() => {
    if (!query.trim() || !routes.length) return;
    const requestId = ++sequence.current;
    let active = true;
    dispatch({ type: "rankingStarted", key, requestId });
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./embedding.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      dispatch({ type: "embeddingFailed", requestId });
      return;
    }
    const fail = () => {
      if (active) dispatch({ type: "embeddingFailed", requestId });
      worker.terminate();
    };
    const timer = setTimeout(fail, 90_000);
    worker.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      if (active)
        dispatch({
          type: "embeddingReceived",
          requestId,
          vectors: data.vectors,
          failed: Boolean(data.error),
        });
      worker.terminate();
    };
    worker.postMessage({
      id: 1,
      text: "",
      texts: [query.slice(0, 500), ...routes.map(externalSearchText)],
    });
    return () => {
      active = false;
      clearTimeout(timer);
      worker.terminate();
    };
  }, [key]);
  const result = selectExternalRanking(state, key, Boolean(query.trim() && routes.length));
  return { ranked: rankExternalRoutes(routes, query, result.vectors), mode: result.mode, limited: result.limited };
}
