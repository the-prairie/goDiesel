import type { RouteSummary } from "./route";

export interface CollectionPlace {
  name: string;
  routes: RouteSummary[];
}

export function collectionPlaces(routes: readonly RouteSummary[]): CollectionPlace[] {
  const places = new Map<string, CollectionPlace>();
  for (const route of routes) {
    if (route.lifecycle === "planned") continue;
    const place = places.get(route.region);
    if (place) place.routes.push(route);
    else places.set(route.region, { name: route.region, routes: [route] });
  }
  return [...places.values()].sort((a, b) => a.name.localeCompare(b.name));
}
