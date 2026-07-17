import { Link, useParams } from "react-router-dom";

import { AvatarEvaluationStage } from "@/components/replay/avatar-evaluation-stage";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { Button } from "@/components/ui/button";
import { routes } from "@/data/routes";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug, replayPath } from "@/navigation";

export function AvatarEvaluationLabPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug);

  if (!summary) return <RouteNotFound />;
  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" className="grid min-h-[50dvh] place-items-center">
        Loading avatar evaluation route.
      </div>
    );
  }
  if (detail.status !== "ready") {
    return (
      <div className="grid min-h-[calc(100dvh-var(--mobile-navigation-height))] place-items-center bg-[#02070a] p-4 md:min-h-dvh">
        <div role="alert" className="max-w-md rounded-md border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Evaluation route could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {"message" in detail ? detail.message : "The route data could not be loaded."}
          </p>
          <Button asChild className="mt-5">
            <Link to={replayPath(summary.slug)}>Return to Replay</Link>
          </Button>
        </div>
      </div>
    );
  }

  const eligibleRoutes = routes.filter((route) => route.replay.replayEligible);
  return <AvatarEvaluationStage route={detail.route} routes={eligibleRoutes} />;
}
