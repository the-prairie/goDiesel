import { useParams } from "react-router-dom";

import { PlayableEarthStage } from "@/components/replay/playable-earth-stage";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug } from "@/navigation";

export function PlayableEarthLabPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug);

  if (!summary) return <RouteNotFound />;
  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center">
        Loading playable route.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  return <PlayableEarthStage route={detail.route} />;
}
