import { replayPath, routeDetailPath } from "@/navigation";

export function normalizeSingleRouteSlug(value: string | undefined) {
  const slug = value?.trim();
  return slug && /^[A-Za-z0-9._-]+$/.test(slug) ? slug : undefined;
}

export const singleRouteMicrositeSlug = normalizeSingleRouteSlug(
  import.meta.env.VITE_SINGLE_ROUTE_SLUG,
);

export const singleRouteMicrosite = singleRouteMicrositeSlug
  ? {
      slug: singleRouteMicrositeSlug,
      guidePath: routeDetailPath(singleRouteMicrositeSlug),
      replayPath: replayPath(singleRouteMicrositeSlug),
    }
  : undefined;
