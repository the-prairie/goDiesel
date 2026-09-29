import { recordedThreadSegments } from "@/domain/geometry/recorded-thread";
import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";

export interface ReliefLineRoute {
  slug: string;
  trace: RoutePoint[];
  /** Recorded gaps in `trace`. Callers resolve them first; none are inferred here. */
  discontinuities?: RouteDiscontinuityEvidence[];
}

/**
 * The neighbouring routes behind the selected one, split where their
 * recordings have gaps. A gap is only ever taken from recorded evidence,
 * never from how far apart the sampled points happen to be.
 */
export function reliefHistoryLines(routes: ReliefLineRoute[], selectedSlug: string | undefined) {
  return routes
    .filter((route) => route.slug !== selectedSlug && route.trace.length > 1)
    .flatMap((route) =>
      recordedThreadSegments(route.trace, route.discontinuities ?? []).map((trace) => ({ slug: route.slug, trace })),
    );
}
