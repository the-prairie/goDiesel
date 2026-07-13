import { Compass } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Metric } from "@/components/metric";
import { PageTitle } from "@/components/page-title";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { hasRouteGeometry } from "@/domain/routes";
import { cn } from "@/lib/utils";
import { replayPath } from "@/navigation";

export function ReplayPage() {
  const { routeSlug } = useParams();
  const selectedRoute = routeSlug
    ? findRouteBySlug(decodeURIComponent(routeSlug))
    : completedRoutes[0];

  if (routeSlug && !selectedRoute) return <RouteNotFound />;

  const pickerRoutes = selectedRoute
    ? [
        selectedRoute,
        ...completedRoutes
          .filter((route) => route.slug !== selectedRoute.slug)
          .slice(0, 11),
      ]
    : completedRoutes.slice(0, 12);

  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Replay"
        title={selectedRoute?.name ?? "Choose a completed route."}
        copy="Replay preserves route selection and direct links while the Earth viewer moves into React."
      />
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-md border border-border bg-card p-5">
          {selectedRoute ? (
            <dl className="grid gap-3 text-sm">
              <Metric label="Distance" value={`${selectedRoute.distanceKm.toFixed(1)} km`} />
              <Metric label="Climb" value={`${selectedRoute.elevationGainM.toLocaleString()} m`} />
              <Metric
                label="Geometry"
                value={hasRouteGeometry(selectedRoute) ? "Ready" : "Missing"}
              />
              <Metric label="Replay mode" value={selectedRoute.replay.replayMode} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a route before entering replay.
            </p>
          )}
        </div>
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
                  selectedRoute?.slug === route.slug && "border-primary bg-primary/10",
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
