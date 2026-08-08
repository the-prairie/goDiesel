import { useParams } from "react-router-dom";

import { CinematicRouteTrailerStage } from "@/surfaces/replay/cinematic/cinematic-route-trailer-stage";
import { RouteNotFound } from "@/surfaces/routes/components/route-not-found";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug } from "@/app/route-paths";

export function CinematicRouteTrailerLabPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug);

  if (!summary) return <RouteNotFound />;
  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div
        aria-live="polite"
        className="grid min-h-[50dvh] place-items-center"
        role="status"
      >
        Preparing cinematic route preview.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  return <CinematicRouteTrailerStage route={detail.route} />;
}
