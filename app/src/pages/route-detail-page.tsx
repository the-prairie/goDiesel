import { ArrowLeft, Compass } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Metric } from "@/components/metric";
import { PageTitle } from "@/components/page-title";
import { RouteBriefing } from "@/components/routes/route-briefing";
import { RouteGuide } from "@/components/routes/route-guide";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { Button } from "@/components/ui/button";
import { findRouteBySlug } from "@/data/routes";
import { routeLibraryReturnPath } from "@/data/route-library-return";
import { useRouteDetail, type RouteDetailState } from "@/data/use-route-detail";
import type { QuestRoute } from "@/domain/routes";
import { APP_PATHS, decodedRouteSlug, replayPath } from "@/navigation";

export function RouteDetailPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const [requestKey, setRequestKey] = useState(0);
  const detail = useRouteDetail(summary?.slug, requestKey);
  const routesPath = summary
    ? (routeLibraryReturnPath(summary.slug) ?? APP_PATHS.routes)
    : APP_PATHS.routes;

  if (!summary) return <RouteNotFound />;

  return (
    <section className="grid content-start gap-6">
      <Button asChild variant="ghost" className="w-fit">
        <Link to={routesPath}>
          <ArrowLeft aria-hidden="true" />
          All routes
        </Link>
      </Button>
      <PageTitle
        eyebrow={summary.region}
        title={summary.name}
        copy={summary.description}
      />
      <RouteDetailContent state={detail} onRetry={() => setRequestKey((key) => key + 1)} />
    </section>
  );
}

function RouteDetailContent({
  state,
  onRetry,
}: {
  state: RouteDetailState;
  onRetry: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground"
      >
        Loading route details.
      </div>
    );
  }

  if (state.status !== "ready") {
    const message =
      state.status === "not-found" ? "Route data could not be found." : state.message;
    return (
      <div role="alert" className="rounded-md border border-border bg-card p-5">
        <div className="font-semibold">Route data unavailable</div>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {state.status === "error" ? (
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  const route = state.route;
  return (
    <div className="grid gap-8">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <dl className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-4">
          <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <Metric label="Activity" value={route.type} />
          <Metric label={routeDateLabel(route.lifecycle)} value={route.date || "Not recorded"} />
        </dl>
        {route.replay.replayEligible ? (
          <Button asChild>
            <Link to={replayPath(route.slug)}>
              <Compass aria-hidden="true" />
              Open replay
            </Link>
          </Button>
        ) : (
          <Button disabled>
            <Compass aria-hidden="true" />
            Replay unavailable
          </Button>
        )}
      </div>
      <RouteBriefing route={route} />
      <RouteGuide curation={route.curation} />
    </div>
  );
}

function routeDateLabel(lifecycle: QuestRoute["lifecycle"]) {
  if (lifecycle === "planned") return "Planned for";
  if (lifecycle === "discovered") return "Discovered";
  return "Completed";
}
