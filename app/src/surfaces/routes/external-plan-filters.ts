import type { ExternalPlan } from "@/data/external-plan-store";
import {
  routeMatchesClimb,
  routeMatchesDistance,
  type RouteFilters,
} from "@/surfaces/routes/route-filters";
export function filterExternalPlans(plans: ExternalPlan[], f: RouteFilters) {
  return plans.filter((p) => {
    const r = p.route;
    return (
      (f.lifecycle === "all" || f.lifecycle === "planned") &&
      (f.activity === "all" || f.activity === r.activity) &&
      (f.region === "all" || f.region === p.place) &&
      f.vibe === "all" &&
      (!f.query ||
        `${r.name} ${p.place} ${r.description ?? ""}`
          .toLowerCase()
          .includes(f.query.toLowerCase())) &&
      routeMatchesDistance(r.distanceKm, f.distance) &&
      (f.climb === "all" ||
        (r.ascentM != null && routeMatchesClimb(r.ascentM, f.climb)))
    );
  });
}
