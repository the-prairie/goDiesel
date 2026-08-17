import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { APP_PATHS, decodedRouteSlug } from "@/app/route-paths";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { findRouteBySlug } from "@/data/routes";
import { usePlannedRoutes } from "@/data/planned-route-store";
import { routeLibraryReturnPath } from "@/data/route-library-return";
import { useRouteDetail, type RouteDetailState } from "@/data/use-route-detail";
import { RouteStoryView } from "@/surfaces/routes/components/route-story-view";
import { PlannedRouteView } from "@/surfaces/routes/components/planned-route-view";
import { Button } from "@/ui/button";
import { RouteNotFound } from "@/ui/route-not-found";
import { cn } from "@/ui/utils";

export function RouteDetailPage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const plannedRoutes = usePlannedRoutes();
  const plannedRoute = decodedSlug
    ? plannedRoutes.find((route) => route.slug === decodedSlug)
    : undefined;
  const [requestKey, setRequestKey] = useState(0);
  const detail = useRouteDetail(summary?.slug, requestKey);
  const routesPath = summary
    ? (routeLibraryReturnPath(summary.slug) ?? APP_PATHS.routes)
    : APP_PATHS.routes;

  if (plannedRoute) return <PlannedRouteView route={plannedRoute} />;
  if (!summary) return <RouteNotFound />;

  return (
    <section
      className={cn(
        "relative min-h-0 overflow-hidden md:h-dvh",
        singleRouteMicrosite
          ? "h-dvh"
          : "h-[calc(100dvh-var(--mobile-navigation-height))]",
      )}
    >
      <RouteDetailContent
        state={detail}
        routesPath={routesPath}
        onRetry={() => setRequestKey((key) => key + 1)}
      />
    </section>
  );
}

function RouteDetailContent({
  state,
  routesPath,
  onRetry,
}: {
  state: RouteDetailState;
  routesPath: string;
  onRetry: () => void;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <RouteStoryState routesPath={routesPath}>
        <p role="status" aria-live="polite" className="font-editorial text-3xl text-ink">
          Loading route story.
        </p>
        <p className="mt-2 text-control text-ink-muted">
          Opening the recorded geography and field notes.
        </p>
      </RouteStoryState>
    );
  }

  if (state.status !== "ready") {
    const message =
      state.status === "not-found" ? "Route data could not be found." : state.message;
    return (
      <RouteStoryState routesPath={routesPath}>
        <div role="alert">
          <p className="font-editorial text-3xl text-ink">Route story unavailable</p>
          <p className="mt-2 text-control text-ink-muted">{message}</p>
          {state.status === "error" ? (
            <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </RouteStoryState>
    );
  }

  return <RouteStoryView route={state.route} routesPath={routesPath} />;
}

function RouteStoryState({
  routesPath,
  children,
}: {
  routesPath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-full place-items-center bg-surface-muted p-6">
      <div className="max-w-md border-y border-line py-8">
        {singleRouteMicrosite ? null : (
          <Button asChild variant="ghost" className="-ml-3 mb-4 w-fit">
            <Link to={routesPath}>
              <ArrowLeft aria-hidden="true" />
              All routes
            </Link>
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
