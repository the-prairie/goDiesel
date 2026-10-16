import { useEffect, useReducer, useRef } from "react";
import type { FinderIntent } from "@/domain/planning";
import type { SearchDocument } from "@/domain/search/ranking";
import { searchCollection } from "../discovery-provider";
import { initialCollectionSearchState, reduceCollectionSearch, selectCollectionSearch } from "./collection-search-state";
let documents: Promise<SearchDocument[]> | undefined;
function loadDocuments() {
  documents ??= fetch("/search/collection.json")
    .then((r) => {
      if (!r.ok) throw Error("Search index unavailable");
      return r.json();
    })
    .then((data) => data.documents as SearchDocument[])
    .catch((error) => {
      documents = undefined;
      throw error;
    });
  return documents;
}
export function useCollectionSearch(intent: FinderIntent | null) {
  const [state, dispatch] = useReducer(reduceCollectionSearch, undefined, initialCollectionSearchState);
  const sequence = useRef(0);
  const key = JSON.stringify(intent);
  useEffect(() => {
    if (!intent) return;
    const requestId = ++sequence.current;
    dispatch({ type: "searchStarted", key, requestId });
    let active = true;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadDocuments()
      .then((docs) => {
        if (!active) return;
        const refine = Boolean((intent.query || intent.vibe) && !intent.similarPlace);
        dispatch({ type: "indexReceived", requestId, docs, refine });
        if (!refine) return;
        worker = new Worker(new URL("./embedding.worker.ts", import.meta.url), {
          type: "module",
        });
        const fallback = () => {
          if (active) dispatch({ type: "embeddingFailed", requestId });
          worker?.terminate();
        };
        timer = setTimeout(fallback, 60_000);
        worker.onerror = fallback;
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          if (active)
            dispatch({ type: "embeddingReceived", requestId, vector: data.vector, failed: Boolean(data.error) });
          worker?.terminate();
        };
        worker.postMessage({
          id: 1,
          text: `${intent.query ?? ""} ${intent.vibe}`.slice(0, 500),
        });
      })
      .catch(() => {
        if (active) dispatch({ type: "indexFailed", requestId });
      });
    return () => {
      active = false;
      worker?.terminate();
      clearTimeout(timer);
    };
  }, [key]); // intent is serialized so equivalent URL state does not restart inference.
  const current = selectCollectionSearch(state, key);
  return {
    result: intent
      ? searchCollection(intent, current.docs, current.vector)
      : null,
    mode: current.mode,
    limited: current.limited,
  };
}
