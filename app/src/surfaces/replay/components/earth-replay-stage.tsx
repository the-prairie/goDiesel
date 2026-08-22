import {
  Gauge,
  Gamepad2,
  LocateFixed,
  Map,
  MousePointer2,
  Pause,
  Play,
  Route,
  Settings2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/ui/button";
import {
  ReplayElevationScrubber,
  type ReplayElevationScrubberHandle,
} from "@/surfaces/replay/components/replay-elevation-scrubber";
import { ReplayRoutePicker } from "@/surfaces/replay/components/replay-route-picker";
import {
  RouteContextHud,
  type RouteContextHudState,
} from "@/surfaces/replay/components/route-context-hud";
import {
  RecordedLightLabel,
  RecordedLightLayer,
} from "@/surfaces/replay/components/recorded-light-layer";
import { recordedLightAt } from "@/domain/geometry/recorded-light";
import type { QuestRoute, RouteSummary } from "@/domain/route";
import { useIsMobile } from "@/ui/use-mobile";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import {
  APP_PATHS,
  playableEarthLabPath,
  routeDetailPath,
} from "@/app/route-paths";
import {
  advanceReplay,
  cycleReplaySpeed,
  initialReplayState,
  REPLAY_CAMERA_RANGES_M,
  replayPose,
  routeDistanceM,
  seekReplay,
  toggleReplay,
  toggleReplayFollowing,
  zoomReplay,
  type ReplayControlState,
} from "@/surfaces/replay/playback/replay-controller";
import {
  createReplayEngine,
  type ReplayEngine,
  type ReplayEngineMode,
  type ReplayStatus,
} from "@/surfaces/replay/renderer-port";

function initialReplayStatus(mode: ReplayEngineMode, experienceLabel = "Replay"): ReplayStatus {
  return mode === "earth"
    ? {
        state: "loading",
        title: "Building your route world",
        message: "Preparing the bundled Earth engine.",
      }
    : {
        state: "loading",
        title: `Opening Atlas ${experienceLabel.toLowerCase()}`,
        message: "Preparing the fallback route map.",
      };
}

export function EarthReplayStage({
  route,
  pickerRoutes,
  backPath,
  backLabel,
  initialEngineMode = "earth",
  allowEarthMode = true,
  experienceMode = "replay",
}: {
  route: QuestRoute;
  pickerRoutes: RouteSummary[];
  backPath: string;
  backLabel: string;
  initialEngineMode?: ReplayEngineMode;
  allowEarthMode?: boolean;
  experienceMode?: "preview" | "replay";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elevationScrubberRef = useRef<
    ReplayElevationScrubberHandle | null
  >(null);
  const engineRef = useRef<ReplayEngine | undefined>(undefined);
  const mountedRouteRef = useRef<string | undefined>(undefined);
  const controlRef = useRef(initialReplayState());
  const experienceLabel = experienceMode === "preview" ? "Preview" : "Replay";
  const [status, setStatus] = useState<ReplayStatus>(() =>
    initialReplayStatus(initialEngineMode, experienceLabel),
  );
  const [engineMode, setEngineMode] =
    useState<ReplayEngineMode>(initialEngineMode);
  const [control, setControl] = useState(controlRef.current);
  const [contextState, setContextState] =
    useState<RouteContextHudState>("preview");
  const [mobileControlsExpanded, setMobileControlsExpanded] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const totalDistanceM = routeDistanceM(route);
  const operational = status.state === "ready" || status.state === "partial";
  const recordedLight = recordedLightAt(
    route.route,
    experienceMode === "preview" ? { status: "unavailable" } : route.provenance.temporal,
    control.progressM,
  );

  const commitControl = useCallback(
    (update: (current: ReplayControlState) => ReplayControlState) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      engineRef.current?.setPose(replayPose(route, next));
      elevationScrubberRef.current?.sync(next.progressM);
    },
    [route],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const routeChanged = mountedRouteRef.current !== route.slug;
    if (routeChanged && engineMode !== initialEngineMode) {
      setEngineMode(initialEngineMode);
      return;
    }
    const engine = createReplayEngine(engineMode);
    engineRef.current = engine;
    const initialControl = routeChanged ? initialReplayState() : controlRef.current;
    mountedRouteRef.current = route.slug;
    controlRef.current = initialControl;
    setControl(initialControl);
    setStatus(initialReplayStatus(engineMode, experienceLabel));
    void engine.mount({
      container,
      route,
      onStatus: (nextStatus) => {
        if (engineRef.current !== engine) return;
        setStatus(nextStatus);
        if (nextStatus.state === "ready" || nextStatus.state === "partial") {
          engine.setPose(replayPose(route, controlRef.current));
        }
      },
    });
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [engineMode, initialEngineMode, route]);

  useEffect(() => {
    if (!operational || !control.playing) return;
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
      elevationScrubberRef.current?.sync(next.progressM);
      if (now - lastUiUpdate >= 80) {
        setControl(next);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [control.playing, operational, route, totalDistanceM]);

  useEffect(() => {
    setContextState(isMobile ? "compact" : "preview");
    setMobileControlsExpanded(false);
  }, [isMobile, route.slug]);

  useEffect(() => {
    if (control.playing) setContextState("compact");
  }, [control.playing]);

  useEffect(() => {
    if (!control.playing || reducedMotion) {
      setChromeVisible(true);
      return;
    }
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      const stage = containerRef.current?.closest("[data-testid='replay-stage']");
      if (!focused || !stage?.contains(focused)) setChromeVisible(false);
    }, 3_200);
    return () => window.clearTimeout(timer);
  }, [control.playing, reducedMotion]);

  return (
    <section
      aria-label={engineMode === "earth" ? `Earth ${experienceLabel}` : `Atlas ${experienceLabel}`}
      data-testid="replay-stage"
      data-engine={engineMode === "earth" ? "cesium-bundled" : "maplibre-atlas"}
      data-state={status.state}
      data-route-slug={route.slug}
      data-progress={control.progressM.toFixed(2)}
      data-speed={control.speed}
      data-following={control.following}
      data-camera-range={control.cameraRangeM}
      data-reduced-motion={reducedMotion}
      data-hud-version="retrace"
      data-playback-owner="single-dock"
      data-chrome-visible={chromeVisible}
      data-light-phase={recordedLight.phase}
      onPointerMove={() => setChromeVisible(true)}
      onFocusCapture={() => setChromeVisible(true)}
      className="relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-[#02070a] md:h-dvh md:min-h-[36rem]"
    >
      <div
        ref={containerRef}
        aria-label={engineMode === "earth" ? `Earth ${experienceLabel} world` : `Atlas ${experienceLabel} map`}
        className="absolute inset-0"
      />
      <RecordedLightLayer light={recordedLight} reducedMotion={reducedMotion} />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-3 sm:p-5">
        <RouteContextHud
          route={route}
          label={engineMode === "earth" ? `Earth ${experienceLabel}` : `Atlas ${experienceLabel}`}
          testId="replay-context"
          detailsTestId="replay-context-details"
          state={contextState}
          backPath={backPath}
          backLabel={backLabel}
          visible={chromeVisible}
          onStateChange={setContextState}
          summary={
            <>
            <div className="mt-1.5">
              <RecordedLightLabel light={recordedLight} />
            </div>
            {route.curation.vibe ? (
              <p className="mt-3 max-w-sm font-editorial text-base italic leading-5 text-ink-secondary">
                {route.curation.vibe}
              </p>
            ) : null}
            {status.state === "partial" ? (
              <div role="status" className="mt-3 border-l-2 border-amber-300 pl-3">
                <div className="text-sm font-semibold">{status.title}</div>
                <p className="mt-1 text-xs text-muted-foreground">{status.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setEngineMode("atlas")}
                >
                  <Map aria-hidden="true" />
                  Use Atlas {experienceLabel.toLowerCase()}
                </Button>
              </div>
            ) : null}
            {engineMode === "atlas" && allowEarthMode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setEngineMode("earth")}
              >
                <Route aria-hidden="true" />
                Try Earth {experienceLabel.toLowerCase()}
              </Button>
            ) : null}
            </>
          }
          actions={
            experienceMode === "preview" ? null : <div className="grid grid-cols-2 gap-2">
              {route.replay.replayEligible ? (
                <Button asChild size="sm" className="w-full bg-forest text-white hover:bg-forest/90">
                  <Link to={playableEarthLabPath(route.slug, "replay")}>
                    <Gamepad2 aria-hidden="true" />
                    Enter route
                  </Link>
                </Button>
              ) : (
                <div role="status" className="text-xs text-muted-foreground">
                  Playable Earth unavailable. This route needs complete recorded geometry.
                </div>
              )}
              <ReplayRoutePicker
                currentSlug={route.slug}
                renderer={allowEarthMode ? "cesium" : "atlas"}
                routes={pickerRoutes}
                returnPath={backPath.startsWith(APP_PATHS.atlas) ? backPath : undefined}
              />
            </div>
          }
        />
      </div>

      {!operational ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/72 p-6">
          <div
            role={status.state === "unavailable" ? "alert" : "status"}
            aria-live="polite"
            className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-2xl"
          >
            <div className="font-semibold">{status.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            {status.state === "unavailable" ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {engineMode === "earth" ? (
                  <Button type="button" onClick={() => setEngineMode("atlas")}>
                    <Map aria-hidden="true" />
                    Use Atlas {experienceLabel.toLowerCase()}
                  </Button>
                ) : null}
                <Button asChild variant={engineMode === "earth" ? "outline" : "default"}>
                  <Link to={experienceMode === "preview" ? backPath : routeDetailPath(route.slug)}>{experienceMode === "preview" ? "Return to Route Studio" : "Return to route guide"}</Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
        <div
          data-testid="replay-controls"
          className="pointer-events-auto w-full border-t border-line bg-surface/96 p-2 text-ink shadow-sheet backdrop-blur sm:flex sm:items-center sm:gap-2 sm:px-3 sm:py-2"
        >
          {isMobile ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Route className="size-4 shrink-0 text-route" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-control text-ink-secondary">
                {(control.progressM / 1_000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11"
                aria-label={
                  mobileControlsExpanded ? "Hide more controls" : "Show more controls"
                }
                aria-expanded={mobileControlsExpanded}
                onClick={() =>
                  setMobileControlsExpanded((expanded) => !expanded)
                }
              >
                <Settings2 aria-hidden="true" />
              </Button>
            </div>
            <ReplayElevationScrubber
              ref={elevationScrubberRef}
              route={route}
              progressM={control.progressM}
              totalDistanceM={totalDistanceM}
              disabled={!operational}
              compact
              onSeek={(progressM) =>
                commitControl((current) =>
                  seekReplay(current, progressM, totalDistanceM),
                )
              }
            />
            {mobileControlsExpanded ? (
              <div
                data-testid="replay-secondary-controls"
                className="flex flex-wrap items-center gap-2 border-t border-line pt-2"
              >
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-11"
                  disabled={
                    !operational || control.cameraRangeM === REPLAY_CAMERA_RANGES_M[0]
                  }
                  aria-label="Zoom in to route"
                  onClick={() => commitControl((current) => zoomReplay(current, "in"))}
                >
                  <ZoomIn aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-11"
                  disabled={
                    !operational ||
                    control.cameraRangeM === REPLAY_CAMERA_RANGES_M.at(-1)
                  }
                  aria-label="Zoom out from route"
                  onClick={() => commitControl((current) => zoomReplay(current, "out"))}
                >
                  <ZoomOut aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!operational}
                  aria-label={`Playback speed ${control.speed}x`}
                  onClick={() => commitControl(cycleReplaySpeed)}
                >
                  <Gauge aria-hidden="true" />
                  {control.speed}x
                </Button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                size="icon"
                className="size-11"
                disabled={!operational}
                aria-label={control.playing ? "Pause route" : "Play route"}
                onClick={() => commitControl(toggleReplay)}
              >
                {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </Button>
              <Button
                type="button"
                variant={control.following ? "default" : "outline"}
                className="h-11 flex-1"
                disabled={!operational}
                aria-label={control.following ? "Release camera" : "Follow route"}
                onClick={() => commitControl(toggleReplayFollowing)}
              >
                {control.following ? (
                  <LocateFixed aria-hidden="true" />
                ) : (
                  <MousePointer2 aria-hidden="true" />
                )}
                {control.following ? "Following" : "Follow route"}
              </Button>
            </div>
          </div>
          ) : (
          <>
          <Route className="size-4 shrink-0 text-route" aria-hidden="true" />
          <div className="min-w-28 flex-1">
            <div className="text-caption font-semibold uppercase text-route">
              {operational ? "Route thread ready" : "Route world loading"}
            </div>
            <div aria-live="off" className="truncate text-control text-ink-secondary">
              {(control.progressM / 1_000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
            </div>
          </div>
          <ReplayElevationScrubber
            ref={elevationScrubberRef}
            route={route}
            progressM={control.progressM}
            totalDistanceM={totalDistanceM}
            disabled={!operational}
            className="min-w-48 flex-[2]"
            onSeek={(progressM) =>
              commitControl((current) =>
                seekReplay(current, progressM, totalDistanceM),
              )
            }
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={!operational}
            aria-label={control.playing ? "Pause route" : "Play route"}
            title={control.playing ? "Pause route" : "Play route"}
            onClick={() => commitControl(toggleReplay)}
          >
            {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant={control.following ? "default" : "outline"}
            disabled={!operational}
            aria-label={control.following ? "Release camera" : "Follow route"}
            title={control.following ? "Release camera" : "Follow route"}
            onClick={() => commitControl(toggleReplayFollowing)}
          >
            {control.following ? (
              <LocateFixed aria-hidden="true" />
            ) : (
              <MousePointer2 aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {control.following ? "Following" : "Free camera"}
            </span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={
              !operational ||
              control.cameraRangeM === REPLAY_CAMERA_RANGES_M[0]
            }
            aria-label="Zoom in to route"
            title="Zoom in to route"
            onClick={() => commitControl((current) => zoomReplay(current, "in"))}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={
              !operational ||
              control.cameraRangeM === REPLAY_CAMERA_RANGES_M.at(-1)
            }
            aria-label="Zoom out from route"
            title="Zoom out from route"
            onClick={() => commitControl((current) => zoomReplay(current, "out"))}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!operational}
            aria-label={`Playback speed ${control.speed}x`}
            title="Change playback speed"
            onClick={() => commitControl(cycleReplaySpeed)}
          >
            <Gauge aria-hidden="true" />
            {control.speed}x
          </Button>
          </>
          )}
          </div>
        </div>
    </section>
  );
}
