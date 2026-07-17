import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Compass,
  Minus,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ElevationProfile } from "@/components/routes/route-briefing";
import { RouteGuide } from "@/components/routes/route-guide";
import { RouteLeafMap } from "@/components/routes/route-leaf-map";
import { RouteNotFound } from "@/components/routes/route-not-found";
import { Button } from "@/components/ui/button";
import { findRouteBySlug } from "@/data/routes";
import { routeLibraryReturnPath } from "@/data/route-library-return";
import { useRouteDetail, type RouteDetailState } from "@/data/use-route-detail";
import type { QuestRoute } from "@/domain/routes";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { APP_PATHS, decodedRouteSlug, replayPath } from "@/navigation";

type RouteMarginPosition = "peek" | "half" | "expanded";

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
    <section className="relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden md:h-dvh">
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
      <RouteLeafState routesPath={routesPath}>
        <p
          role="status"
          aria-live="polite"
          className="font-editorial text-2xl font-semibold text-ink"
        >
          Loading route details.
        </p>
        <p className="mt-2 text-control text-ink-muted">
          Opening the recorded geography and field notes.
        </p>
      </RouteLeafState>
    );
  }

  if (state.status !== "ready") {
    const message =
      state.status === "not-found" ? "Route data could not be found." : state.message;
    return (
      <RouteLeafState routesPath={routesPath}>
        <div role="alert">
          <p className="font-editorial text-2xl font-semibold text-ink">
            Route data unavailable
          </p>
          <p className="mt-2 text-control text-ink-muted">{message}</p>
          {state.status === "error" ? (
            <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </RouteLeafState>
    );
  }

  return <RouteLeaf route={state.route} routesPath={routesPath} />;
}

function RouteLeaf({ route, routesPath }: { route: QuestRoute; routesPath: string }) {
  const isMobile = useIsMobile();
  const [position, setPosition] = useState<RouteMarginPosition>("peek");

  return (
    <div
      role="region"
      aria-label="Route briefing"
      className="relative grid h-full min-h-0 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(24rem,1fr)]"
    >
      <RouteLeafMap route={route} />
      <RouteMargin
        route={route}
        routesPath={routesPath}
        isMobile={isMobile}
        position={position}
        onPositionChange={setPosition}
      />
    </div>
  );
}

function RouteMargin({
  route,
  routesPath,
  isMobile,
  position,
  onPositionChange,
}: {
  route: QuestRoute;
  routesPath: string;
  isMobile: boolean;
  position: RouteMarginPosition;
  onPositionChange: (position: RouteMarginPosition) => void;
}) {
  const hasDetails = !isMobile || position !== "peek";
  const premise = route.description || route.completionRule;

  return (
    <aside
      aria-label="Route margin"
      data-snap={isMobile ? position : undefined}
      className={cn(
        "z-20 flex min-h-0 flex-col overflow-hidden border-line bg-surface/97 text-ink shadow-panel backdrop-blur transition-[height] duration-[var(--duration-standard)]",
        isMobile && position === "peek" &&
          "absolute inset-x-3 bottom-0 h-[13rem] rounded-t-sm border",
        isMobile && position === "half" &&
          "absolute inset-x-3 bottom-0 h-[58dvh] rounded-t-sm border",
        isMobile && position === "expanded" &&
          "absolute inset-x-3 bottom-0 h-[calc(100dvh-0.75rem)] rounded-t-sm border",
        !isMobile && "relative h-full border-l",
      )}
    >
      {isMobile ? (
        <div className="flex min-h-6 items-center justify-center border-b border-line">
          <span className="h-1 w-10 rounded-full bg-ink-faint" aria-hidden="true" />
        </div>
      ) : null}

      <div className={cn("border-b border-line", isMobile ? "p-3" : "p-6")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 w-fit">
              <Link to={routesPath}>
                <ArrowLeft aria-hidden="true" />
                All routes
              </Link>
            </Button>
            <p className="text-caption font-semibold uppercase text-cobalt">
              {route.region}
            </p>
            <h1 className="mt-1 font-editorial text-3xl font-semibold leading-none text-ink">
              {route.name}
            </h1>
          </div>
          {isMobile ? (
            <div className="flex shrink-0 gap-1">
              {position !== "peek" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Collapse route margin"
                  onClick={() => onPositionChange("peek")}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Set route margin to half"
                onClick={() => onPositionChange("half")}
              >
                <Minus aria-hidden="true" />
              </Button>
              {position !== "expanded" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Expand route margin"
                  onClick={() => onPositionChange("expanded")}
                >
                  <ChevronUp aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasDetails ? (
          <>
            <p className="mt-4 font-editorial text-lg italic leading-6 text-ink-secondary">
              {premise}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <LeafMetric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <LeafMetric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
              <LeafMetric label="Activity" value={route.type} />
              <LeafMetric
                label={routeDateLabel(route.lifecycle)}
                value={route.date || "Not recorded"}
              />
            </dl>
          </>
        ) : null}
      </div>

      {hasDetails ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24">
          {route.route.length > 1 ? (
            <section aria-label="Elevation" className="border-b border-line pb-6">
              <p className="text-caption font-semibold uppercase text-ink-muted">
                Elevation
              </p>
              <div className="mt-2 overflow-hidden border border-line bg-surface-muted">
                <ElevationProfile route={route} />
              </div>
            </section>
          ) : (
            <div role="status" className="border-b border-line pb-6 text-control text-ink-muted">
              Elevation profile unavailable. Climb distribution needs recorded route points.
            </div>
          )}
          <div className="pt-6">
            <RouteGuide curation={route.curation} compact />
          </div>
        </div>
      ) : null}

      <div className="mt-auto border-t border-line bg-surface p-3 sm:p-4">
        {route.replay.replayEligible ? (
          <Button asChild className="w-full bg-forest text-white hover:bg-forest/90">
            <Link to={replayPath(route.slug)}>
              <Compass aria-hidden="true" />
              Open replay
            </Link>
          </Button>
        ) : (
          <Button disabled className="w-full">
            <Compass aria-hidden="true" />
            Replay unavailable
          </Button>
        )}
      </div>
    </aside>
  );
}

function LeafMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 font-editorial text-xl text-ink">{value}</dd>
    </div>
  );
}

function RouteLeafState({
  routesPath,
  children,
}: {
  routesPath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-full place-items-center bg-surface-muted p-6">
      <div className="max-w-md border-y border-line py-8">
        <Button asChild variant="ghost" className="-ml-3 mb-4 w-fit">
          <Link to={routesPath}>
            <ArrowLeft aria-hidden="true" />
            All routes
          </Link>
        </Button>
        {children}
      </div>
    </div>
  );
}

function routeDateLabel(lifecycle: QuestRoute["lifecycle"]) {
  if (lifecycle === "planned") return "Planned for";
  if (lifecycle === "discovered") return "Discovered";
  return "Completed";
}
