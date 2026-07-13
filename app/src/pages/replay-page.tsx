import { Compass } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Metric } from "@/components/metric";
import { PageTitle } from "@/components/page-title";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { useRouteDetail, type RouteDetailState } from "@/data/use-route-detail";
import { hasRouteGeometry } from "@/domain/routes";
import { cn } from "@/lib/utils";
import { decodedRouteSlug, replayPath } from "@/navigation";

export function ReplayPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const selectedSummary = routeSlug
    ? decodedSlug
      ? findRouteBySlug(decodedSlug)
      : undefined
    : completedRoutes[0];
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

  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Replay"
        title={selectedSummary?.name ?? "Choose a completed route."}
        copy="Replay preserves route selection and direct links while the Earth viewer moves into React."
      />
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <ReplaySummary state={detail} />
        <div className="rounded-md border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2 font-semibold">
            <Compass className="size-4 text-primary" aria-hidden="true" />
            Completed route picker
          </div>
          <div className="grid gap-2 pr-2 md:max-h-80 md:overflow-y-auto">
            {pickerRoutes.map((route) => (
              <Link
                key={route.slug}
                to={replayPath(route.slug)}
                className={cn(
                  "rounded-md border border-border px-3 py-3 text-left text-sm outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
                  selectedSummary?.slug === route.slug && "border-primary bg-primary/10",
                )}
              >
                <div className="font-medium">{route.name}</div>
                <div className="text-muted-foreground">
                  {route.distanceKm.toFixed(1)} km · {route.difficulty}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReplaySummary({ state }: { state: RouteDetailState }) {
  return (
    <div className="rounded-md border border-border bg-card p-5">
      {(state.status === "idle" || state.status === "loading") && (
        <p className="text-sm text-muted-foreground">Loading replay data.</p>
      )}
      {state.status === "ready" && (
        <dl className="grid gap-3 text-sm">
          <Metric label="Distance" value={`${state.route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${state.route.elevationGainM.toLocaleString()} m`} />
          <Metric
            label="Geometry"
            value={hasRouteGeometry(state.route) ? "Ready" : "Missing"}
          />
          <Metric label="Replay mode" value={state.route.replay.replayMode} />
        </dl>
      )}
      {state.status === "not-found" && (
        <p role="alert" className="text-sm text-muted-foreground">
          Route data could not be found.
        </p>
      )}
      {(state.status === "invalid" || state.status === "error") && (
        <p role="alert" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      )}
    </div>
  );
}
