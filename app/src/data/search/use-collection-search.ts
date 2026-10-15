import { useEffect, useState } from "react";
import type { FinderIntent } from "@/domain/planning";
import type { SearchDocument } from "@/domain/search/ranking";
import { searchCollection } from "../discovery-provider";
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
  const [state, setState] = useState<{
    key: string;
    docs: SearchDocument[];
    vector?: number[];
    mode: string;
  }>({ key: "", docs: [], mode: "" });
  const key = JSON.stringify(intent);
  useEffect(() => {
    if (!intent) return;
    let active = true;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadDocuments()
      .then((docs) => {
        if (!active) return;
        setState({ key, docs, mode: "Keyword search" });
        if ((!intent.query && !intent.vibe) || intent.similarPlace) return;
        setState({ key, docs, mode: "Finding related guide themes…" });
        worker = new Worker(new URL("./embedding.worker.ts", import.meta.url), {
          type: "module",
        });
        const fallback = () => {
          if (active)
            setState({
              key,
              docs,
              mode: "Keyword search · related-theme search unavailable",
            });
          worker?.terminate();
        };
        timer = setTimeout(fallback, 60_000);
        worker.onerror = fallback;
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          if (active)
            setState({
              key,
              docs,
              vector: data.vector,
              mode: data.error
                ? "Keyword search · related-theme search unavailable"
                : "Keyword + related-theme search",
            });
          worker?.terminate();
        };
        worker.postMessage({
          id: 1,
          text: `${intent.query ?? ""} ${intent.vibe}`.slice(0, 500),
        });
      })
      .catch(() => {
        if (active)
          setState({
            key,
            docs: [],
            mode: "Basic search · full guide index unavailable",
          });
      });
    return () => {
      active = false;
      worker?.terminate();
      clearTimeout(timer);
    };
  }, [key]); // intent is serialized so equivalent URL state does not restart inference.
  const current =
    state.key === key
      ? state
      : { docs: [], vector: undefined, mode: "Searching guides…" };
  return {
    result: intent
      ? searchCollection(intent, current.docs, current.vector)
      : null,
    mode: current.mode,
  };
}
