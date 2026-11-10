import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";

export function routeYear(date: string): number | null {
  const year = Number(date.slice(0, 4));
  if (!Number.isInteger(year) || year < 1900 || year > 2500) return null;
  return year;
}

export function memoryYears(routes: RouteSummary[]): number[] {
  const years = new Set<number>();
  for (const route of routes) {
    const year = routeYear(route.date);
    if (year !== null) years.add(year);
  }
  return [...years].sort((left, right) => left - right);
}

export function routesInYear(routes: RouteSummary[], year: number): RouteSummary[] {
  const prefix = String(year);
  return routes.filter((route) => route.date.startsWith(prefix));
}

export interface MemoryPlace {
  name: string;
  count: number;
  kilometres: number;
}

export function placesInYear(routes: RouteSummary[], year: number): MemoryPlace[] {
  const places = new Map<string, MemoryPlace>();
  for (const route of routesInYear(routes, year)) {
    const current = places.get(route.region) ?? {
      name: route.region,
      count: 0,
      kilometres: 0,
    };
    current.count += 1;
    current.kilometres += route.distanceKm;
    places.set(route.region, current);
  }
  return [...places.values()].sort(
    (left, right) => right.count - left.count || right.kilometres - left.kilometres,
  );
}

export function latestRoute(routes: RouteSummary[]): RouteSummary | undefined {
  return [...routes].sort((left, right) => right.date.localeCompare(left.date))[0];
}

export function chapterOrder(regions: RouteRegion[]): RouteRegion[] {
  const latestDate = (region: RouteRegion) =>
    region.routes.reduce((latest, route) => (route.date > latest ? route.date : latest), "");
  return [...regions].sort((left, right) => latestDate(right).localeCompare(latestDate(left)));
}

export function yearFromPointer(clientX: number, left: number, width: number, years: number[]): number | null {
  if (years.length === 0 || width <= 0) return null;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  const index = Math.round(ratio * (years.length - 1));
  return years[index] ?? null;
}
