import { useEffect, useState } from "react";

import {
  loadRouteDetail,
  type RouteDetailResult,
} from "@/data/route-repository";

export type RouteDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | RouteDetailResult;

export function useRouteDetail(slug?: string, requestKey = 0) {
  const [loaded, setLoaded] = useState<{
    slug: string;
    requestKey: number;
    result: RouteDetailResult;
  }>();

  useEffect(() => {
    if (!slug) {
      return;
    }

    let active = true;
    void loadRouteDetail(slug).then((result) => {
      if (active) setLoaded({ slug, requestKey, result });
    });

    return () => {
      active = false;
    };
  }, [requestKey, slug]);

  if (!slug) return { status: "idle" } satisfies RouteDetailState;
  if (loaded?.slug !== slug || loaded.requestKey !== requestKey) {
    return { status: "loading" } satisfies RouteDetailState;
  }
  return loaded.result;
}
