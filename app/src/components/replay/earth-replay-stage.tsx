import { ArrowLeft, ChevronDown, Pause, Play, Route } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { QuestRoute, RouteSummary } from "@/domain/routes";
import { APP_PATHS, replayPath, routeDetailPath } from "@/navigation";
import {
  advanceReplay,
  initialReplayState,
  replayPose,
  routeDistanceM,
  toggleReplay,
  type ReplayControlState,
} from "@/replay/replay-controller";
import {
  createReplayEngine,
  type ReplayEngine,
  type ReplayStatus,
} from "@/replay/replay-engine";

const INITIAL_STATUS: ReplayStatus = {
  state: "loading",
  title: "Building your route world",
  message: "Preparing the bundled Earth engine.",
};

export function EarthReplayStage({
  route,
  pickerRoutes,
}: {
  route: QuestRoute;
  pickerRoutes: RouteSummary[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReplayEngine | undefined>(undefined);
  const controlRef = useRef(initialReplayState());
  const [status, setStatus] = useState<ReplayStatus>(INITIAL_STATUS);
  const [control, setControl] = useState(controlRef.current);
  const totalDistanceM = routeDistanceM(route);

  const commitControl = useCallback(
    (update: (current: ReplayControlState) => ReplayControlState) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      engineRef.current?.setPose(replayPose(route, next));
    },
    [route],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createReplayEngine();
    engineRef.current = engine;
    const initialControl = initialReplayState();
    controlRef.current = initialControl;
    setControl(initialControl);
    setStatus(INITIAL_STATUS);
    void engine.mount({
      container,
      route,
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.state === "ready") {
          engine.setPose(replayPose(route, controlRef.current));
        }
      },
    });
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [route]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let frame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const next = advanceReplay(
        controlRef.current,
        (now - previous) / 1_000,
        totalDistanceM,
      );
      previous = now;
      controlRef.current = next;
      engineRef.current?.setPose(replayPose(route, next));
      if (now - lastUiUpdate >= 80) {
        setControl(next);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [route, status.state, totalDistanceM]);

  return (
    <section
      aria-label="Earth Replay"
      data-engine="cesium-bundled"
      data-state={status.state}
      data-route-slug={route.slug}
      data-progress={control.progressM.toFixed(2)}
      className="relative min-h-[calc(100dvh-3.5rem)] overflow-hidden bg-[#02070a]"
    >
      <div
        ref={containerRef}
        aria-label="Earth Replay world"
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-md rounded-md border border-border bg-background/90 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <Route className="size-4" aria-hidden="true" />
            Earth Replay
          </div>
          <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{route.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up
          </p>
          {route.curation.vibe ? (
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              {route.curation.vibe}
            </p>
          ) : null}
          <details className="relative mt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-t border-border pt-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Change route
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
            </summary>
            <div className="absolute left-0 top-full z-30 mt-3 grid max-h-64 w-[min(22rem,calc(100vw-2rem))] gap-1 overflow-y-auto rounded-md border border-border bg-background p-2 shadow-2xl">
              {pickerRoutes.map((pickerRoute) => (
                <Link
                  key={pickerRoute.slug}
                  to={replayPath(pickerRoute.slug)}
                  aria-current={pickerRoute.slug === route.slug ? "page" : undefined}
                  className="rounded-sm border border-transparent px-3 py-2 text-sm outline-none hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:bg-primary/10"
                >
                  <span className="block font-medium">{pickerRoute.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {pickerRoute.distanceKm.toFixed(1)} km · {pickerRoute.difficulty}
                  </span>
                </Link>
              ))}
            </div>
          </details>
        </div>
        <div className="pointer-events-auto flex shrink-0 gap-2">
          <Button asChild variant="secondary" size="icon">
            <Link to={APP_PATHS.routes} aria-label="All routes" title="All routes">
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={routeDetailPath(route.slug)}>Route guide</Link>
          </Button>
        </div>
      </div>

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/72 p-6">
          <div
            role={status.state === "unavailable" ? "alert" : "status"}
            aria-live="polite"
            className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-2xl"
          >
            <div className="font-semibold">{status.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            {status.state === "unavailable" ? (
              <Button asChild className="mt-5">
                <Link to={routeDetailPath(route.slug)}>Return to route guide</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center sm:inset-x-6 sm:bottom-6">
        <div className="pointer-events-auto flex w-full max-w-4xl items-center gap-3 rounded-md border border-border bg-background/92 px-3 py-3 shadow-2xl backdrop-blur">
          <Route className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-28 flex-1">
            <div className="text-xs font-semibold uppercase text-primary">
              {status.state === "ready" ? "Route thread ready" : "Route world loading"}
            </div>
            <div aria-live="off" className="truncate text-sm text-muted-foreground">
              {(control.progressM / 1_000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={status.state !== "ready"}
            aria-label={control.playing ? "Pause route" : "Play route"}
            title={control.playing ? "Pause route" : "Play route"}
            onClick={() => commitControl(toggleReplay)}
          >
            {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </section>
  );
}
