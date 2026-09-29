import { useEffect, useMemo, useState } from "react";

import { loadRouteDetail } from "@/data/route-repository";
import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";
import type { ReliefRoute } from "@/ui/maps/relief-world";

interface OverviewRoute {
  slug: string;
  trace: RoutePoint[];
  discontinuities?: RouteDiscontinuityEvidence[];
}

/**
 * Overview routes with their recorded gaps resolved. A summary's own gaps are
 * used when the manifest carries them; otherwise the route's canonical detail
 * record supplies them. A route whose gaps are not yet known is left out, so
 * the overview never draws a line across a gap it has not seen.
 */
export function useResolvedRouteGaps(routes: OverviewRoute[]): ReliefRoute[] {
  const [loaded, setLoaded] = useState<Record<string, RouteDiscontinuityEvidence[] | null>>({});
  const pending = useMemo(
    () => routes.filter((route) => route.discontinuities === undefined && !(route.slug in loaded)).map((route) => route.slug),
    [routes, loaded],
  );

  useEffect(() => {
    if (!pending.length) return;
    let active = true;
    for (const slug of pending) {
      void loadRouteDetail(slug).then((result) => {
        if (!active) return;
        // A detail that cannot be read leaves the gaps unknown: not drawn.
        setLoaded((current) => ({ ...current, [slug]: result.status === "ready" ? result.route.provenance.discontinuities : null }));
      });
    }
    return () => {
      active = false;
    };
  }, [pending]);

  return useMemo(
    () =>
      routes.flatMap((route) => {
        const gaps = route.discontinuities ?? loaded[route.slug];
        return gaps ? [{ slug: route.slug, trace: route.trace, discontinuities: gaps }] : [];
      }),
    [routes, loaded],
  );
}
