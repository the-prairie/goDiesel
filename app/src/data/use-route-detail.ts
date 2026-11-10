import { useEffect, useReducer } from "react";

import { loadRouteDetail } from "@/data/route-repository";
import {
  initialRouteDetailLoadState,
  reduceRouteDetailLoad,
  routeDetailView,
  type RouteDetailLoadEvent,
  type RouteDetailState,
} from "@/data/route-detail-state";

export type { RouteDetailState };

export function useRouteDetail(slug?: string, requestKey = 0) {
  const [state, dispatch] = useReducer(reduceRouteDetailLoad, undefined, initialRouteDetailLoadState);
  let current = state;
  const event: RouteDetailLoadEvent | undefined = !slug
    ? state.status === "idle"
      ? undefined
      : { type: "selectionCleared" }
    : state.status !== "idle" && state.slug === slug && state.requestKey === requestKey
      ? undefined
      : { type: "loadStarted", slug, requestKey };
  if (event) {
    current = reduceRouteDetailLoad(state, event);
    dispatch(event);
  }

  useEffect(() => {
    if (!slug) return;
    let active = true;
    void loadRouteDetail(slug).then((result) => {
      if (active) dispatch({ type: "resultReceived", slug, requestKey, result });
    });
    return () => {
      active = false;
    };
  }, [requestKey, slug]);

  return routeDetailView(current);
}
