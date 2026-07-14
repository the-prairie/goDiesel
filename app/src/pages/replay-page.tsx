import { useParams } from "react-router-dom";

import { EarthReplayStage } from "@/components/replay/earth-replay-stage";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug } from "@/navigation";

const representativeRoute =
  completedRoutes.find(
    (route) => route.replay.bestInEarth && route.replay.replayEligible,
  ) ?? completedRoutes.find((route) => route.replay.replayEligible);

export function ReplayPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const selectedSummary = routeSlug
    ? decodedSlug
      ? findRouteBySlug(decodedSlug)
      : undefined
    : representativeRoute;
  const detail = useRouteDetail(selectedSummary?.slug);

  if (routeSlug && !selectedSummary) return <RouteNotFound />;

  const pickerRoutes = selectedSummary
    ? [
        selectedSummary,
        ...completedRoutes
          .filter((route) => route.slug !== selectedSummary.slug)
          .slice(0, 11),
      ]
    : completedRoutes.slice(0, 12);

  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center">
        Loading Earth Replay.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  return <EarthReplayStage route={detail.route} pickerRoutes={pickerRoutes} />;
}
