import generated from "@/data/generated/routes.manifest.json";
import { isCompletedRoute } from "@/domain/route-lifecycle";
import { parseRouteSummary, type RouteSummary } from "@/domain/routes";

interface GeneratedRouteManifest {
  routes?: unknown[];
}

const manifest = generated as GeneratedRouteManifest;

export const routes: RouteSummary[] = (manifest.routes ?? []).map(parseRouteSummary);

export const completedRoutes = routes.filter(isCompletedRoute);
export const plannedRoutes = routes.filter((route) => route.lifecycle === "planned");
export const discoveredRoutes = routes.filter(
  (route) => route.lifecycle === "discovered",
);

export function findRouteBySlug(slug: string) {
  return routes.find((route) => route.slug === slug);
}
