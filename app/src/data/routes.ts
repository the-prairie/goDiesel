import generated from "@/data/quests.generated.json";
import { isCompletedRoute } from "@/domain/route-lifecycle";
import { toQuestRoute, type QuestRoute } from "@/domain/routes";

interface GeneratedRoutePayload {
  routes?: unknown[];
}

const payload = generated as GeneratedRoutePayload;

export const routes: QuestRoute[] = (payload.routes ?? [])
  .filter((route): route is Record<string, unknown> => Boolean(route))
  .map((route) => toQuestRoute(route));

export const completedRoutes = routes.filter(isCompletedRoute);
export const plannedRoutes = routes.filter((route) => route.lifecycle === "planned");
export const discoveredRoutes = routes.filter(
  (route) => route.lifecycle === "discovered",
);

export function findRouteBySlug(slug: string) {
  return routes.find((route) => route.slug === slug);
}

export function routeHash(route: Pick<QuestRoute, "slug">) {
  return `#quest/${encodeURIComponent(route.slug)}`;
}
