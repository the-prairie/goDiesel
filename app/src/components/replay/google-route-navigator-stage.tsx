import {
  Eye,
  Gauge,
  MapPinned,
  Mountain,
  Navigation,
  Pause,
  Play,
  Route,
  ScanLine,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  RouteContextHud,
  type RouteContextHudState,
} from "@/components/replay/route-context-hud";
import { Button } from "@/components/ui/button";
import type { QuestRoute } from "@/domain/routes";
import { cn } from "@/lib/utils";
import {
  advanceGoogleRouteNavigator,
  cycleGoogleRouteSpeed,
  googleRouteCameraPose,
  initialGoogleRouteNavigatorState,
  seekGoogleRouteNavigator,
  zoomGoogleRouteNavigator,
  type GoogleRouteCameraMode,
  type GoogleRouteNavigatorState,
} from "@/replay/google-route-navigator-controller";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorStatus,
} from "@/replay/google/google-route-navigator-engine";
import { routeDistanceM } from "@/replay/route-path";

const FIELD_TEST_ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

const INITIAL_STATUS: GoogleRouteNavigatorStatus = {
  state: "loading",
  message: "Preparing the native Google 3D route world.",
};

const CAMERA_MODES: Array<{
  mode: GoogleRouteCameraMode;
  label: string;
  icon: typeof Navigation;
}> = [
  { mode: "runner", label: "Runner", icon: Navigation },
  { mode: "chase", label: "Chase", icon: Eye },
  { mode: "overview", label: "Overview", icon: MapPinned },
];

export function GoogleRouteNavigatorStage({ route }: { route: QuestRoute }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const controlRef = useRef(initialGoogleRouteNavigatorState());
  const [control, setControl] = useState(controlRef.current);
  const [status, setStatus] = useState<GoogleRouteNavigatorStatus>(INITIAL_STATUS);
  const [contextState, setContextState] =
    useState<RouteContextHudState>("preview");
  const totalDistanceM = routeDistanceM(route);

  const commitControl = useCallback(
    (
      update: (
        current: GoogleRouteNavigatorState,
      ) => GoogleRouteNavigatorState,
    ) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      engineRef.current?.setFollowing(next.following);
      engineRef.current?.setGrounding(next.groundingMode);
      if (next.following) {
        engineRef.current?.setCamera(googleRouteCameraPose(route, next));
      }
    },
    [route],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createGoogleRouteNavigatorEngine();
    const initial = initialGoogleRouteNavigatorState();
    engineRef.current = engine;
    controlRef.current = initial;
    setControl(initial);
    setContextState("preview");
    setStatus(INITIAL_STATUS);

    void engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: initial.groundingMode,
      onStatus: (next) => {
        setStatus(next);
        if (next.state === "ready") {
          engine.setCamera(googleRouteCameraPose(route, controlRef.current));
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
    let animationFrame = 0;
    let previous = performance.now();
    let lastCameraUpdate = previous;
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const next = advanceGoogleRouteNavigator(
        controlRef.current,
        (now - previous) / 1_000,
        totalDistanceM,
      );
      previous = now;
      controlRef.current = next;
      if (next.following && now - lastCameraUpdate >= 32) {
        engineRef.current?.setCamera(googleRouteCameraPose(route, next));
        lastCameraUpdate = now;
      }
      if (now - lastUiUpdate >= 90) {
        setControl(next);
        lastUiUpdate = now;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [route, status.state, totalDistanceM]);

  useEffect(() => {
    if (control.playing) setContextState("compact");
  }, [control.playing]);

  return (
    <section
      aria-label="Google route navigator lab"
      className="relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-[34rem] overflow-hidden bg-[#d9e5e8] md:h-dvh"
      data-camera-mode={control.cameraMode}
      data-following={control.following}
      data-grounding-mode={control.groundingMode}
      data-route-slug={route.slug}
      data-state={status.state}
      data-testid="google-route-navigator"
    >
      <div
        aria-label={`Google photorealistic 3D view of ${route.name}`}
        className="absolute inset-0"
        ref={containerRef}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start p-3 sm:p-5">
        <RouteContextHud
          backLabel="Back to route intelligence"
          backPath="/lab/route-intelligence"
          detailsTestId="google-route-context-details"
          icon={<ScanLine aria-hidden="true" className="size-4 shrink-0" />}
          label="Native Google 3D lab"
          onStateChange={setContextState}
          route={route}
          state={contextState}
          summary={
            <div className="mt-3 flex flex-wrap gap-2">
              {FIELD_TEST_ROUTES.map((candidate) => (
                <Button
                  asChild
                  className="h-8"
                  key={candidate.slug}
                  size="sm"
                  variant={candidate.slug === route.slug ? "default" : "outline"}
                >
                  <Link to={`/lab/google-route-navigator/${candidate.slug}`}>
                    {candidate.label}
                  </Link>
                </Button>
              ))}
            </div>
          }
          testId="google-route-context"
        />
      </div>

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/78 p-6">
          <div
            aria-live="polite"
            className="max-w-md border border-line bg-surface p-6 text-center shadow-panel"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine aria-hidden="true" className="mx-auto size-5 text-route" />
            <h2 className="mt-3 font-editorial text-2xl font-semibold">
              {status.state === "loading" ? "Entering the route" : "3D world unavailable"}
            </h2>
            <p className="mt-2 text-control text-ink-secondary">{status.message}</p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center sm:inset-x-5 sm:bottom-5">
        <div
          className="pointer-events-auto grid w-full max-w-6xl gap-3 border border-line bg-surface/94 p-3 shadow-panel backdrop-blur-xl lg:grid-cols-[auto_minmax(12rem,1fr)_auto_auto] lg:items-center"
          data-testid="google-route-controls"
        >
          <div className="flex min-w-36 items-center gap-3">
            <Route aria-hidden="true" className="size-4 shrink-0 text-route" />
            <div>
              <div className="text-micro font-semibold uppercase text-route">
                Route thread
              </div>
              <div
                aria-live="off"
                className="text-control tabular-nums text-ink-secondary"
                data-testid="google-route-progress"
              >
                {(control.progressM / 1_000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
              </div>
            </div>
          </div>

          <input
            aria-label="Route progress"
            className="h-9 min-w-0 w-full accent-[var(--route)]"
            disabled={status.state !== "ready"}
            max={totalDistanceM}
            min={0}
            onChange={(event) =>
              commitControl((current) =>
                seekGoogleRouteNavigator(
                  current,
                  Number(event.target.value),
                  totalDistanceM,
                ),
              )
            }
            step={1}
            type="range"
            value={control.progressM}
          />

          <div
            aria-label="Camera perspective"
            className="grid grid-cols-3 border border-line bg-surface-muted p-1"
            role="group"
          >
            {CAMERA_MODES.map(({ mode, label, icon: Icon }) => (
              <button
                aria-label={label}
                aria-pressed={control.cameraMode === mode}
                className={cn(
                  "flex min-h-9 items-center justify-center gap-1.5 px-2 text-caption font-medium",
                  control.cameraMode === mode
                    ? "bg-forest text-white"
                    : "text-ink-secondary hover:bg-surface",
                )}
                disabled={status.state !== "ready"}
                key={mode}
                onClick={() =>
                  commitControl((current) => ({
                    ...current,
                    cameraMode: mode,
                    following: true,
                  }))
                }
                title={`${label} camera`}
                type="button"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              aria-label={control.playing ? "Pause route" : "Play route"}
              disabled={status.state !== "ready"}
              onClick={() =>
                commitControl((current) => ({
                  ...current,
                  playing: !current.playing,
                }))
              }
              size="icon"
              type="button"
            >
              {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </Button>
            <Button
              aria-label={`Playback speed ${control.speed}x`}
              disabled={status.state !== "ready"}
              onClick={() => commitControl(cycleGoogleRouteSpeed)}
              title="Change playback speed"
              type="button"
              variant="outline"
            >
              <Gauge aria-hidden="true" />
              {control.speed}x
            </Button>
            <Button
              aria-label="Zoom in"
              disabled={status.state !== "ready"}
              onClick={() =>
                commitControl((current) =>
                  zoomGoogleRouteNavigator(current, "in"),
                )
              }
              size="icon"
              title="Zoom in"
              type="button"
              variant="outline"
            >
              <ZoomIn aria-hidden="true" />
            </Button>
            <Button
              aria-label="Zoom out"
              disabled={status.state !== "ready"}
              onClick={() =>
                commitControl((current) =>
                  zoomGoogleRouteNavigator(current, "out"),
                )
              }
              size="icon"
              title="Zoom out"
              type="button"
              variant="outline"
            >
              <ZoomOut aria-hidden="true" />
            </Button>
            <Button
              aria-label={control.following ? "Take manual control" : "Resume following"}
              disabled={status.state !== "ready"}
              onClick={() =>
                commitControl((current) => ({
                  ...current,
                  following: !current.following,
                }))
              }
              type="button"
              variant={control.following ? "default" : "outline"}
            >
              <Navigation aria-hidden="true" />
              {control.following ? "Following" : "Resume"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 lg:col-span-4">
            <div className="flex items-center gap-2 text-caption text-ink-secondary">
              <Mountain aria-hidden="true" className="size-4 text-forest" />
              Route placement
            </div>
            <div
              aria-label="Route placement"
              className="grid grid-cols-2 border border-line bg-surface-muted p-1"
              role="group"
            >
              {(["ground", "mesh"] as const).map((mode) => (
                <button
                  aria-pressed={control.groundingMode === mode}
                  className={cn(
                    "min-h-8 px-3 text-caption font-medium capitalize",
                    control.groundingMode === mode
                      ? "bg-forest text-white"
                      : "text-ink-secondary hover:bg-surface",
                  )}
                  disabled={status.state !== "ready"}
                  key={mode}
                  onClick={() =>
                    commitControl((current) => ({
                      ...current,
                      groundingMode: mode,
                    }))
                  }
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
