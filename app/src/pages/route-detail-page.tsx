import { ArrowLeft, Compass } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Metric } from "@/components/metric";
import { PageTitle } from "@/components/page-title";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { Button } from "@/components/ui/button";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail, type RouteDetailState } from "@/data/use-route-detail";
import { hasRouteGeometry } from "@/domain/routes";
import { APP_PATHS, replayPath } from "@/navigation";

export function RouteDetailPage() {
  const { routeSlug } = useParams();
  const summary = routeSlug ? findRouteBySlug(decodeURIComponent(routeSlug)) : undefined;
  const detail = useRouteDetail(summary?.slug);

  if (!summary) return <RouteNotFound />;

  return (
    <section className="grid gap-6">
      <Button asChild variant="ghost" className="w-fit">
        <Link to={APP_PATHS.routes}>
          <ArrowLeft aria-hidden="true" />
          All routes
        </Link>
      </Button>
      <PageTitle
        eyebrow={summary.region}
        title={summary.name}
        copy={summary.description}
      />
      <RouteDetailContent state={detail} />
    </section>
  );
}

function RouteDetailContent({ state }: { state: RouteDetailState }) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
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
      </div>
    );
  }

  const route = state.route;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <dl className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-4">
        <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
        <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
        <Metric label="Activity" value={route.type} />
        <Metric label="Difficulty" value={route.difficulty} />
      </dl>
      {hasRouteGeometry(route) ? (
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
  );
}
