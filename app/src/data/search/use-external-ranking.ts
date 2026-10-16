import { useEffect, useState } from "react";
import type { ExternalRoute } from "@/domain/search/external";
import {
  externalSearchText,
  rankExternalRoutes,
} from "@/domain/search/external-ranking";
export function useExternalRanking(routes: ExternalRoute[], query: string) {
  const key = JSON.stringify([
    query,
    routes.map((r) => [r.id, externalSearchText(r)]),
  ]);
  const [state, setState] = useState<{
    key: string;
    vectors?: number[][];
    mode: string;
  }>({ key: "", mode: "" });
  useEffect(() => {
    if (!query.trim() || !routes.length) return;
    let active = true;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./embedding.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      setState({ key, mode: "Keyword ranking · related-theme search unavailable" });
      return;
    }
    setState({ key, mode: "Refining matches…" });
    const fail = () => {
      if (active)
        setState({
          key,
          mode: "Keyword ranking · related-theme search unavailable",
        });
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
        setState({
          key,
          vectors: data.vectors,
          mode: data.error
            ? "Keyword ranking · related-theme search unavailable"
            : "Keyword + related-theme ranking",
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
  return {
    ranked: rankExternalRoutes(
      routes,
      query,
      state.key === key ? state.vectors : undefined,
    ),
    mode:
      query.trim() && routes.length
        ? state.key === key
          ? state.mode
          : "Ranking matches…"
        : "",
  };
}
