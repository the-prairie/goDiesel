import type { RouteRegion } from "@/data/route-regions";

export type AtlasLens = "routes" | "terrain";

export interface TerrainReading {
  highPointM: number;
  reliefM: number;
  recordedClimbM: number;
  sampleCount: number;
}

export interface RouteTerrainDistinction {
  label: "Recorded relief" | "High point";
  valueM: number;
}

export function latestRecordedRegion(regions: RouteRegion[]) {
  return regions.reduce<RouteRegion | undefined>((latest, region) => {
    const regionDate = newestRecordedDate(region);
    if (!regionDate) return latest;
    if (!latest) return region;
    const latestDate = newestRecordedDate(latest);
    if (!latestDate || regionDate > latestDate) return region;
    if (regionDate < latestDate) return latest;
    return region.name.localeCompare(latest.name) < 0 ? region : latest;
  }, undefined);
}

export function shouldOpenLatestRegion(searchParams: URLSearchParams) {
  return (
    [...searchParams.keys()].length === 0 &&
    searchParams.get("view") !== "world"
  );
}

export function atlasLensFromSearchParams(searchParams: URLSearchParams): AtlasLens {
  return searchParams.has("region") && searchParams.get("lens") === "terrain"
    ? "terrain"
    : "routes";
}

export function deriveTerrainReading(region: RouteRegion): TerrainReading | null {
  const elevations = region.routes.flatMap((route) =>
    route.trace
      .map((point) => point.elev)
      .filter((elevation) => Number.isFinite(elevation)),
  );
  if (elevations.length === 0) return null;

  const highPointM = Math.max(...elevations);
  const lowPointM = Math.min(...elevations);
  return {
    highPointM,
    reliefM: highPointM - lowPointM,
    recordedClimbM: region.totalClimbM,
    sampleCount: elevations.length,
  };
}

export function deriveRouteTerrainDistinction(
  route: RouteRegion["routes"][number],
): RouteTerrainDistinction | null {
  const elevations = route.trace
    .map((point) => point.elev)
    .filter((elevation) => Number.isFinite(elevation));
  if (elevations.length === 0) return null;

  const highPointM = Math.max(...elevations);
  const reliefM = highPointM - Math.min(...elevations);
  return reliefM >= 30
    ? { label: "Recorded relief", valueM: reliefM }
    : { label: "High point", valueM: highPointM };
}

function newestRecordedDate(region: RouteRegion) {
  return region.routes.reduce<string | undefined>(
    (latest, route) => (!latest || route.date > latest ? route.date : latest),
    undefined,
  );
}
