import { useEffect, useState } from "react";

import {
  parseRouteDetail,
  type QuestRoute,
  type RouteSummary,
} from "@/domain/route";

const ownerApiBase =
  import.meta.env.VITE_ADMIN_API_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8766";

let ownerRoutesRequest: Promise<QuestRoute[]> | undefined;

export function invalidateOwnerRoutes() {
  ownerRoutesRequest = undefined;
}

export function ownerRouteSummary(route: QuestRoute): RouteSummary {
  const {
    annotations: _annotations,
    curation,
    midIdx: _midIdx,
    provenance: _provenance,
    route: trace,
    ...summary
  } = route;
  const terrain = (curation.terrain ?? []).filter(
    (value): value is "road" | "trail" | "mixed" | "mountain" =>
      value === "road" ||
      value === "trail" ||
      value === "mixed" ||
      value === "mountain",
  );
  const vibes = [curation.vibe, curation.idealUse, route.theme].filter(
    (value): value is string => Boolean(value),
  );
  return {
    ...summary,
    trace,
    guide: {
      reviewStatus: curation.reviewStatus,
      ...(curation.vibe ? { vibe: curation.vibe } : {}),
    },
    discovery: { terrain, vibes: [...new Set(vibes)] },
  };
}

export function loadOwnerRoutes() {
  if (ownerRoutesRequest) return ownerRoutesRequest;
  ownerRoutesRequest = fetch(`${ownerApiBase}/api/owner/routes`)
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Owner routes could not be loaded.");
      }
      if (!Array.isArray(body.routes)) {
        throw new Error("Owner route read model is invalid.");
      }
      return body.routes.map(parseRouteDetail);
    })
    .catch((error) => {
      ownerRoutesRequest = undefined;
      throw error;
    });
  return ownerRoutesRequest;
}

export async function loadOwnerRouteDetail(slug: string) {
  const response = await fetch(
    `${ownerApiBase}/api/owner/routes/${encodeURIComponent(slug)}`,
  );
  if (response.status === 404) return undefined;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Owner route could not be loaded.");
  }
  const route = parseRouteDetail(body);
  if (route.slug !== slug) {
    throw new Error("Owner route did not match the selected route.");
  }
  return route;
}

export function useOwnerRoutes() {
  const [routes, setRoutes] = useState<QuestRoute[]>([]);
  useEffect(() => {
    let active = true;
    void loadOwnerRoutes()
      .then((loaded) => active && setRoutes(loaded))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return routes;
}

export function mergeRouteSummaries(
  bundled: RouteSummary[],
  ownerDetails: QuestRoute[],
) {
  const bySlug = new Map(bundled.map((route) => [route.slug, route]));
  for (const detail of ownerDetails) {
    bySlug.set(detail.slug, ownerRouteSummary(detail));
  }
  return [...bySlug.values()];
}
