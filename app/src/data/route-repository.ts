import { parseRouteDetail, type QuestRoute } from "@/domain/route";

export type RouteDetailResult =
  | { status: "ready"; route: QuestRoute }
  | { status: "not-found" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

const routeDetailRequests = new Map<string, Promise<RouteDetailResult>>();

function routeDetailUrl(slug: string) {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}data/routes/${encodeURIComponent(slug)}.json`;
}

async function fetchRouteDetail(slug: string): Promise<RouteDetailResult> {
  let response: Response;
  try {
    response = await fetch(routeDetailUrl(slug));
  } catch {
    return { status: "error", message: "Route data could not be loaded." };
  }

  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) {
    return {
      status: "error",
      message: `Route data request failed with status ${response.status}.`,
    };
  }

  try {
    const route = parseRouteDetail(await response.json());
    if (route.slug !== slug) {
      return { status: "invalid", message: "Route data did not match the selected route." };
    }
    return { status: "ready", route };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "Route data is invalid.",
    };
  }
}

export function loadRouteDetail(slug: string) {
  const existing = routeDetailRequests.get(slug);
  if (existing) return existing;

  const request = fetchRouteDetail(slug).then((result) => {
    if (result.status === "error" && routeDetailRequests.get(slug) === request) {
      routeDetailRequests.delete(slug);
    }
    return result;
  });
  routeDetailRequests.set(slug, request);
  return request;
}
