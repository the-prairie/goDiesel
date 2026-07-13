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
  const [state, setState] = useState<RouteDetailState>(
    slug ? { status: "loading" } : { status: "idle" },
  );

  useEffect(() => {
    if (!slug) {
      setState({ status: "idle" });
      return;
    }

    let active = true;
    setState({ status: "loading" });
    void loadRouteDetail(slug).then((result) => {
      if (active) setState(result);
    });

    return () => {
      active = false;
    };
  }, [slug]);

  return state;
}
