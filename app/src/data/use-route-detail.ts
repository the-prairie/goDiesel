import { useEffect, useState } from "react";

import {
  loadRouteDetail,
  type RouteDetailResult,
} from "@/data/route-repository";

export type RouteDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | RouteDetailResult;

export function useRouteDetail(slug?: string) {
  const [loaded, setLoaded] = useState<{
    slug: string;
    result: RouteDetailResult;
  }>();

  useEffect(() => {
    if (!slug) {
      return;
    }

    let active = true;
    void loadRouteDetail(slug).then((result) => {
      if (active) setLoaded({ slug, result });
    });

    return () => {
      active = false;
    };
  }, [slug]);

  if (!slug) return { status: "idle" } satisfies RouteDetailState;
  if (loaded?.slug !== slug) return { status: "loading" } satisfies RouteDetailState;
  return loaded.result;
}
