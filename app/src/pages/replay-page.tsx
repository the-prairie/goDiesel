import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { EarthReplayStage } from "@/components/replay/earth-replay-stage";
import { GoogleRouteNavigatorStage } from "@/components/replay/google-route-navigator-stage";
import { RouteNotFound } from "@/surfaces/routes/components/route-not-found";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { APP_PATHS, atlasReturnPath, decodedRouteSlug } from "@/app/route-paths";

const representativeRoute =
  completedRoutes.find(
    (route) => route.replay.bestInEarth && route.replay.replayEligible,
  ) ?? completedRoutes.find((route) => route.replay.replayEligible);

export function ReplayPage() {
  const { routeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const selectedSummary = routeSlug
    ? decodedSlug
      ? findRouteBySlug(decodedSlug)
      : undefined
    : representativeRoute;
  const detail = useRouteDetail(selectedSummary?.slug);
  const requestedRenderer = searchParams.get("renderer");
  const requestedAtlas = requestedRenderer === "atlas";
  const useLegacyEarth = requestedRenderer === "cesium";
  const [atlasFallback, setAtlasFallback] = useState(requestedAtlas);

  useEffect(() => {
    setAtlasFallback(requestedAtlas);
  }, [requestedAtlas, selectedSummary?.slug]);

  if (routeSlug && !selectedSummary) return <RouteNotFound />;

  const eligibleRoutes = completedRoutes.filter(
    (route) => route.replay.replayEligible,
  );
  const pickerRoutes = singleRouteMicrosite
    ? []
    : selectedSummary
    ? [
        selectedSummary,
        ...eligibleRoutes.filter((route) => route.slug !== selectedSummary.slug),
      ]
    : eligibleRoutes;

  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center">
        Loading Earth Replay.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  const returnPath = atlasReturnPath(searchParams);
  const backPath = singleRouteMicrosite?.guidePath ?? returnPath ?? APP_PATHS.routes;
  const backLabel = singleRouteMicrosite
    ? "Route guide"
    : returnPath
      ? "Back to Atlas"
      : "All routes";
  if (!useLegacyEarth && !atlasFallback) {
    return (
      <GoogleRouteNavigatorStage
        route={detail.route}
        variant="replay"
        pickerRoutes={pickerRoutes}
        backPath={backPath}
        backLabel={backLabel}
        onUseAtlas={() => setAtlasFallback(true)}
      />
    );
  }

  return (
    <EarthReplayStage
      route={detail.route}
      pickerRoutes={pickerRoutes}
      backPath={backPath}
      backLabel={backLabel}
      initialEngineMode={atlasFallback ? "atlas" : "earth"}
      allowEarthMode={useLegacyEarth}
    />
  );
}
