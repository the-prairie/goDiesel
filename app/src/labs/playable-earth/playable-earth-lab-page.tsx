import { Link, useParams, useSearchParams } from "react-router-dom";

import { PlayableEarthStage } from "@/labs/playable-earth/playable-earth-stage";
import { RouteNotFound } from "@/surfaces/routes/components/route-not-found";
import { Button } from "@/ui/button";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug, replayPath, routeDetailPath } from "@/app/route-paths";

export function PlayableEarthLabPage() {
  const { routeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug);
  const returnToReplay = searchParams.get("from") === "replay";

  if (!summary) return <RouteNotFound />;
  const exitPath = returnToReplay
    ? replayPath(summary.slug)
    : routeDetailPath(summary.slug);
  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center">
        Loading playable route.
      </div>
    );
  }
  if (detail.status !== "ready") {
    return (
      <PlayableEarthUnavailable
        title="Playable route could not load"
        message={
          "message" in detail ? detail.message : "The route data could not be loaded."
        }
        exitPath={exitPath}
        returnToReplay={returnToReplay}
      />
    );
  }
  if (!detail.route.replay.replayEligible) {
    return (
      <PlayableEarthUnavailable
        title="Playable Earth unavailable"
        message="This route needs complete recorded geometry before it can be entered."
        exitPath={exitPath}
        returnToReplay={returnToReplay}
      />
    );
  }

  return <PlayableEarthStage route={detail.route} exitPath={exitPath} />;
}

function PlayableEarthUnavailable({
  title,
  message,
  exitPath,
  returnToReplay,
}: {
  title: string;
  message: string;
  exitPath: string;
  returnToReplay: boolean;
}) {
  return (
    <div className="grid min-h-[calc(100dvh-var(--mobile-navigation-height))] place-items-center bg-[#02070a] p-4 md:min-h-dvh">
      <div role="alert" className="max-w-md rounded-md border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button asChild className="mt-5">
          <Link to={exitPath}>
            {returnToReplay ? "Return to Replay" : "Return to route guide"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
