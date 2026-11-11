import { useParams } from "react-router-dom";

import { GoogleRouteNavigatorStage } from "@/surfaces/replay/components/google-route-navigator-stage";
import { RouteNotFound } from "@/ui/route-not-found";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug } from "@/app/route-paths";

export function GoogleRouteNavigatorLabPage() {
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
        Loading native Google 3D route.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  return <GoogleRouteNavigatorStage route={detail.route} />;
}
