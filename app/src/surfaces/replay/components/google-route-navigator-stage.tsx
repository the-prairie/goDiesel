import {
  ArrowLeft,
  Eye,
  Gauge,
  LocateFixed,
  LockKeyhole,
  MapPinned,
  Mountain,
  Pause,
  Play,
  Route,
  ScanLine,
  Settings2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ReplayElevationScrubber } from "@/surfaces/replay/components/replay-elevation-scrubber";
import {
  formatReplayDuration,
  formatReplayPace,
  REPLAY_CAMERA_MODES,
  ReplayCameraControls,
} from "@/surfaces/replay/components/replay-presentation";
import { ReplayRoutePicker } from "@/surfaces/replay/components/replay-route-picker";
import { Button } from "@/ui/button";
import type { QuestRoute, RouteSummary } from "@/domain/route";
import { cn } from "@/ui/utils";
import {
  advanceGoogleRouteNavigator,
  cycleGoogleRouteSpeed,
  googleRouteCameraPose,
  googleRouteThreadTreatment,
  googleRouteTelemetry,
  initialGoogleRouteNavigatorState,
  seekGoogleRouteNavigator,
  zoomGoogleRouteNavigator,
  type GoogleRouteCameraMode,
  type GoogleRouteNavigatorState,
} from "@/surfaces/replay/playback/route-navigator-controller";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorStatus,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";
import { routeDistanceM } from "@/domain/geometry/route-path";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import {
  advanceRouteCameraMotion,
  createRouteCameraMotionState,
  type RouteCameraMotionState,
} from "@/surfaces/replay/scene/route-camera-stabilizer";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import {
  activeReplayStoryChapter,
  replayStoryChapters,
} from "@/surfaces/replay/story-flight/story-flight-chapters";
import { StoryFlightReplayHud } from "@/surfaces/replay/story-flight/story-flight-replay-hud";

const FIELD_TEST_ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

const INITIAL_STATUS: GoogleRouteNavigatorStatus = {
  state: "loading",
  message: "Preparing the native Google 3D route world.",
};

interface GoogleRouteNavigatorStageProps {
  route: QuestRoute;
  variant?: "lab" | "replay";
  pickerRoutes?: RouteSummary[];
  backPath?: string;
  backLabel?: string;
  onUseAtlas?: () => void;
}

export function GoogleRouteNavigatorStage({
  route,
  variant = "lab",
  pickerRoutes = [],
  backPath = "/lab/route-intelligence",
  backLabel = "Back to route intelligence",
  onUseAtlas,
}: GoogleRouteNavigatorStageProps) {
  const navigate = useNavigate();
  const productionReplay = variant === "replay";
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const cameraMotionRef = useRef<RouteCameraMotionState | undefined>(undefined);
  const cameraTargetRef = useRef<GoogleRouteCameraPose | undefined>(undefined);
  const cameraSettlingRef = useRef(false);
  const lastCameraAtRef = useRef<number | undefined>(undefined);
  const chromeTimerRef = useRef<number | undefined>(undefined);
  const controlRef = useRef(initialGoogleRouteNavigatorState());
  const [control, setControl] = useState(controlRef.current);
  const [status, setStatus] =
    useState<GoogleRouteNavigatorStatus>(INITIAL_STATUS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const totalDistanceM = routeDistanceM(route);
  const storyChapters = useMemo(
    () => replayStoryChapters(route, totalDistanceM),
    [route, totalDistanceM],
  );
  const telemetry = useMemo(
    () => googleRouteTelemetry(route, control.progressM),
    [control.progressM, route],
  );
  const cameraPose = useMemo(
    () => googleRouteCameraPose(route, control),
    [control, route],
  );
  const activeChapterIndex = activeReplayStoryChapter(
    storyChapters,
    control.progressM,
  );
  const activeChapter = storyChapters[activeChapterIndex];

  const renderCamera = useCallback(
    (
      desired: GoogleRouteCameraPose,
      now = performance.now(),
      force = false,
    ) => {
      const previous = cameraMotionRef.current;
      const previousAt = lastCameraAtRef.current;
      const elapsedSeconds =
        previousAt === undefined
          ? 1 / 30
          : Math.min(0.1, (now - previousAt) / 1_000);
      const motion =
        force || !previous
          ? createRouteCameraMotionState(desired)
          : advanceRouteCameraMotion(previous, desired, elapsedSeconds, 0.48);
      cameraMotionRef.current = motion;
      cameraTargetRef.current = desired;
      cameraSettlingRef.current = !cameraPoseHasSettled(motion.pose, desired);
      lastCameraAtRef.current = now;
      engineRef.current?.setCamera(motion.pose);
    },
    [],
  );

  const commitControl = useCallback(
    (
      update: (current: GoogleRouteNavigatorState) => GoogleRouteNavigatorState,
    ) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      engineRef.current?.setFollowing(next.following);
      engineRef.current?.setGrounding(next.groundingMode);
      if (next.following) {
        renderCamera(googleRouteCameraPose(route, next));
      }
      engineRef.current?.setCinematicRoute(
        googleRouteThreadTreatment(route, next),
      );
    },
    [renderCamera, route],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createGoogleRouteNavigatorEngine();
    const initial = initialGoogleRouteNavigatorState();
    engineRef.current = engine;
    cameraMotionRef.current = undefined;
    cameraTargetRef.current = undefined;
    cameraSettlingRef.current = false;
    lastCameraAtRef.current = undefined;
    controlRef.current = initial;
    setControl(initial);
    setSettingsOpen(false);
    setChromeVisible(true);
    setStatus(INITIAL_STATUS);

    void engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: initial.groundingMode,
      initialCamera: googleRouteCameraPose(route, initial),
      routeStyle: {
        color: "#ef684e",
        mode: "filament",
        outerColor: "#15100d",
        outerWidth: 0.14,
        width: 3,
      },
      onStatus: (next) => {
        setStatus(next);
        if (next.state === "ready") {
          renderCamera(
            googleRouteCameraPose(route, controlRef.current),
            performance.now(),
            true,
          );
          engine.setCinematicRoute(
            googleRouteThreadTreatment(route, controlRef.current),
          );
        }
      },
    });

    return () => {
      engine.destroy();
      cameraMotionRef.current = undefined;
      cameraTargetRef.current = undefined;
      cameraSettlingRef.current = false;
      lastCameraAtRef.current = undefined;
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [renderCamera, route]);

  const scheduleChromeHide = useCallback(() => {
    if (chromeTimerRef.current !== undefined) {
      window.clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = undefined;
    }
    if (
      !productionReplay ||
      !controlRef.current.playing ||
      reducedMotion ||
      settingsOpen
    ) {
      return;
    }
    chromeTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false);
      chromeTimerRef.current = undefined;
    }, 3_200);
  }, [productionReplay, reducedMotion, settingsOpen]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    setChromeVisible(true);
    scheduleChromeHide();
    return () => {
      if (chromeTimerRef.current !== undefined) {
        window.clearTimeout(chromeTimerRef.current);
        chromeTimerRef.current = undefined;
      }
    };
  }, [control.playing, scheduleChromeHide]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastCameraUpdate = previous;
    let lastRouteUpdate = previous;
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const current = controlRef.current;
      const next = advanceGoogleRouteNavigator(
        current,
        (now - previous) / 1_000,
        totalDistanceM,
      );
      previous = now;
      controlRef.current = next;
      const progressChanged = next.progressM !== current.progressM;
      const playbackChanged = next.playing !== current.playing;
      const cameraSettling = cameraSettlingRef.current;
      if (
        next.following &&
        (progressChanged || cameraSettling) &&
        (playbackChanged || now - lastCameraUpdate >= 32)
      ) {
        const desired = progressChanged
          ? googleRouteCameraPose(route, next)
          : cameraTargetRef.current;
        if (desired) renderCamera(desired, now);
        lastCameraUpdate = now;
      }
      if (
        progressChanged &&
        (playbackChanged || now - lastRouteUpdate >= 40)
      ) {
        engineRef.current?.setCinematicRoute(
          googleRouteThreadTreatment(route, next),
        );
        lastRouteUpdate = now;
      }
      if (
        playbackChanged ||
        (progressChanged && now - lastUiUpdate >= 90)
      ) {
        setControl(next);
        lastUiUpdate = now;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [renderCamera, route, status.state, totalDistanceM]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") navigate(backPath);
      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        commitControl((current) => ({ ...current, playing: !current.playing }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backPath, commitControl, navigate]);

  const togglePlayback = () =>
    commitControl((current) => ({
      ...current,
      playing: !current.playing,
    }));

  const selectCamera = (mode: GoogleRouteCameraMode) =>
    commitControl((current) => ({
      ...current,
      cameraMode: mode,
      following: true,
    }));

  return (
    <section
      aria-label={
        productionReplay ? "Google 3D Replay" : "Google route navigator lab"
      }
      className={cn(
        "fixed inset-y-0 right-0 top-0 z-[100] min-h-[34rem] overflow-hidden bg-[#10182c]",
        productionReplay
          ? "left-0"
          : "bottom-0 left-0",
      )}
      data-camera-mode={control.cameraMode}
      data-camera-clearance-m={cameraPose.clearanceM?.toFixed(2)}
      data-minimum-camera-clearance-m={cameraPose.minimumClearanceM?.toFixed(2)}
      data-camera-protection={cameraPose.protection?.join(" ") ?? "manual"}
      data-directed-camera={cameraPose.directedMode ?? control.cameraMode}
      data-following={control.following}
      data-grounding-mode={control.groundingMode}
      data-hud-state={chromeVisible ? "expanded" : "hidden"}
      data-engine="google-3d-maps"
      data-replay-shell={productionReplay ? "story-flight" : "field-lab"}
      data-route-slug={route.slug}
      data-state={status.state}
      data-testid={productionReplay ? "replay-stage" : "google-route-navigator"}
      onFocusCapture={revealChrome}
      onPointerDown={revealChrome}
      onPointerMove={revealChrome}
    >
      <div
        aria-label={`Google photorealistic 3D view of ${route.name}`}
        className="absolute inset-0"
        ref={containerRef}
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-10",
          productionReplay
            ? "bg-[linear-gradient(180deg,rgba(12,22,48,.58)_0%,rgba(12,22,48,.08)_24%,rgba(12,22,48,.05)_55%,rgba(12,22,48,.7)_100%)]"
            : "bg-[linear-gradient(180deg,rgba(0,0,0,.42)_0%,transparent_22%,transparent_70%,rgba(0,0,0,.52)_100%)]",
        )}
      />

      <header
        aria-hidden={productionReplay && !chromeVisible ? true : undefined}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-white transition-opacity duration-300 sm:px-5",
          productionReplay
            ? "min-h-16 border-b border-white/18 bg-[#152345]/34 backdrop-blur-lg"
            : "border-b border-white/15 bg-black/42 backdrop-blur-md",
          productionReplay && !chromeVisible && "opacity-0",
        )}
        inert={productionReplay && !chromeVisible ? true : undefined}
      >
        <div className="pointer-events-auto flex min-w-0 items-center gap-3">
          <Button
            aria-label={backLabel}
            className="border-white/20 bg-black/25 text-white hover:bg-white/10"
            onClick={() => navigate(backPath)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          {!productionReplay ? (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{route.region}</h1>
              <div className="truncate text-[11px] text-white/58">
                {route.distanceKm.toFixed(1)} km ·{" "}
                {Math.round(route.elevationGainM)} m up · {route.type}
              </div>
            </div>
          ) : null}
        </div>

        {productionReplay ? (
          <div className="min-w-0 text-center">
            <div className="text-[9px] font-semibold uppercase text-white/58">
              Now replaying
            </div>
            <h1
              className={cn(
                "break-words font-editorial font-semibold leading-[1.05]",
                route.activityName.length > 80
                  ? "text-[10px] sm:text-sm"
                  : route.activityName.length > 40
                    ? "text-xs sm:text-lg"
                    : "text-sm sm:text-xl",
              )}
            >
              {route.activityName}
            </h1>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase text-white/62">
            <ScanLine aria-hidden="true" className="size-3.5 text-[#ef684e]" />
            Field replay
          </div>
        )}

        <div className="pointer-events-auto flex items-center justify-end gap-1.5 sm:gap-2">
          <div className="hidden items-center gap-1.5 text-[11px] text-white/72 md:flex">
            {control.following ? (
              <LockKeyhole aria-hidden="true" className="size-3.5" />
            ) : (
              <Unlock aria-hidden="true" className="size-3.5" />
            )}
            <span>
              {control.cameraMode === "auto"
                ? `Auto · ${cameraPose.directedMode === "overview" ? "Reveal" : "Follow"}`
                : REPLAY_CAMERA_MODES.find(
                    ({ mode }) => mode === control.cameraMode,
                  )
                    ?.label}
            </span>
          </div>
          {productionReplay ? (
            <span className="hidden text-[9px] font-semibold uppercase text-white/58 sm:inline">
              Google 3D Replay
            </span>
          ) : null}
          <Button
            aria-expanded={settingsOpen}
            aria-label="Replay settings"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setSettingsOpen((open) => !open)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Settings2 aria-hidden="true" />
          </Button>
          {productionReplay && pickerRoutes.length > 0 ? (
            <div className="text-ink sm:min-w-36">
              <ReplayRoutePicker
                compact
                currentSlug={route.slug}
                routes={pickerRoutes}
                returnPath={
                  backPath.startsWith("/atlas") ? backPath : undefined
                }
              />
            </div>
          ) : null}
        </div>
      </header>

      {productionReplay && activeChapter ? (
        <div
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute left-5 top-[18%] z-20 max-w-[min(38rem,calc(100vw-2.5rem))] text-white transition-opacity duration-300 sm:left-[6vw] sm:top-[22%]",
            !chromeVisible && "opacity-0",
          )}
          data-testid="replay-active-chapter"
        >
          <div className="text-[10px] font-semibold uppercase text-white/72 sm:text-xs">
            Chapter {activeChapterIndex + 1} · {route.region}
          </div>
          <h2 className="mt-1 font-editorial text-5xl font-medium leading-[0.88] drop-shadow-lg sm:text-7xl lg:text-8xl">
            {activeChapter.label}
          </h2>
          <p className="mt-3 font-editorial text-lg italic text-[#ffd6e9] sm:text-2xl">
            {(control.progressM / 1_000).toFixed(1)} km ·{" "}
            {Math.round(telemetry.elevationM)} m
          </p>
        </div>
      ) : null}

      {settingsOpen ? (
        <ReplaySettings
          control={control}
          onCommit={commitControl}
          onSelectCamera={selectCamera}
          route={route}
          showFieldRoutes={!productionReplay}
        />
      ) : null}

      {status.state !== "ready" ? (
        <div
          className={cn(
            "absolute inset-0 z-20 grid place-items-center p-6",
            status.state === "unavailable"
              ? "bg-[#182238]"
              : "bg-black/58 backdrop-blur-sm",
          )}
        >
          <div
            aria-live="polite"
            className="max-w-md border border-white/20 bg-[#0b1112]/94 p-6 text-center text-white shadow-2xl"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine
              aria-hidden="true"
              className="mx-auto size-5 text-[#ef684e]"
            />
            <h2 className="mt-3 font-editorial text-2xl font-semibold">
              {status.state === "loading"
                ? "Entering the route"
                : "3D world unavailable"}
            </h2>
            <p className="mt-2 text-sm text-white/62">{status.message}</p>
            {status.state === "unavailable" && onUseAtlas ? (
              <Button
                className="mt-5 bg-white text-black hover:bg-white/90"
                onClick={onUseAtlas}
                type="button"
              >
                <MapPinned aria-hidden="true" />
                Use Atlas replay
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        aria-hidden={productionReplay && !chromeVisible ? true : undefined}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-opacity duration-300",
          productionReplay && !chromeVisible && "opacity-0",
        )}
        data-testid={productionReplay ? "replay-controls" : undefined}
        inert={productionReplay && !chromeVisible ? true : undefined}
      >
        {productionReplay ? (
          <StoryFlightReplayHud
            activeChapterIndex={activeChapterIndex}
            chapters={storyChapters}
            control={control}
            disabled={status.state !== "ready"}
            onCommit={commitControl}
            onSelectCamera={selectCamera}
            onTogglePlayback={togglePlayback}
            route={route}
            telemetry={telemetry}
            totalDistanceM={totalDistanceM}
          />
        ) : (
          <ExpandedReplayHud
            control={control}
            disabled={status.state !== "ready"}
            onCommit={commitControl}
            onSelectCamera={selectCamera}
            onTogglePlayback={togglePlayback}
            route={route}
            telemetry={telemetry}
            totalDistanceM={totalDistanceM}
          />
        )}
      </div>
    </section>
  );
}

function cameraPoseHasSettled(
  current: GoogleRouteCameraPose,
  desired: GoogleRouteCameraPose,
) {
  const headingDelta = Math.abs(
    ((desired.headingDeg - current.headingDeg + 540) % 360) - 180,
  );
  return (
    Math.abs(current.center.lat - desired.center.lat) < 0.000_001 &&
    Math.abs(current.center.lng - desired.center.lng) < 0.000_001 &&
    Math.abs(
      (current.center.altitude ?? desired.center.altitude ?? 0) -
        (desired.center.altitude ?? current.center.altitude ?? 0),
    ) < 0.5 &&
    headingDelta < 0.2 &&
    Math.abs(current.rangeM - desired.rangeM) < 1.5 &&
    Math.abs(current.tiltDeg - desired.tiltDeg) < 0.1 &&
    Math.abs(current.fovDeg - desired.fovDeg) < 0.1
  );
}

function ExpandedReplayHud({
  control,
  disabled,
  onCommit,
  onSelectCamera,
  onTogglePlayback,
  route,
  telemetry,
  totalDistanceM,
}: ReplayHudProps) {
  return (
    <div
      className="pointer-events-auto mx-auto w-full border-t border-white/15 bg-[#071011]/94 text-white shadow-2xl backdrop-blur-xl"
      data-testid="google-route-controls"
    >
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] md:min-h-28 md:grid-cols-[15rem_minmax(18rem,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2 border-r border-white/12 px-3 py-2 md:gap-3 md:px-4 md:py-3">
          <ReplayButton
            disabled={disabled}
            onClick={onTogglePlayback}
            playing={control.playing}
          />
          <Route
            aria-hidden="true"
            className="hidden size-4 text-[#ef684e] md:block"
          />
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase text-[#ef684e]">
              Route telemetry
            </div>
            <div
              className="mt-0.5 truncate text-[11px] font-semibold tabular-nums md:text-sm"
              data-testid="google-route-progress"
            >
              {(control.progressM / 1_000).toFixed(2)} /{" "}
              {route.distanceKm.toFixed(1)} km
            </div>
          </div>
        </div>

        <ReplayElevationScrubber
          className="h-[4.75rem] border-0 md:h-[6.25rem]"
          disabled={disabled}
          onSeek={(progressM) =>
            onCommit((current) =>
              seekGoogleRouteNavigator(current, progressM, totalDistanceM),
            )
          }
          progressM={control.progressM}
          route={route}
          tone="intelligence"
          totalDistanceM={totalDistanceM}
        />

        <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-t border-white/12 px-3 py-2 md:col-span-1 md:min-w-[27rem] md:gap-4 md:border-l md:border-t-0 md:px-4 md:py-3">
          <div className="grid min-w-0 flex-1 grid-cols-4 gap-x-2 md:gap-x-5 md:gap-y-2">
            <Metric
              label="Elapsed"
              value={formatReplayDuration(telemetry.elapsedS)}
            />
            <Metric
              label="Pace"
              value={formatReplayPace(telemetry.paceSPerKm, route.type)}
            />
            <Metric
              label="Elevation"
              value={`${Math.round(telemetry.elevationM)} m`}
            />
            <Metric
              label="Grade"
              value={`${telemetry.gradePercent >= 0 ? "+" : ""}${telemetry.gradePercent.toFixed(1)}%`}
            />
          </div>
          <div className="flex items-center gap-2">
            <ReplayCameraControls
              active={control.cameraMode}
              disabled={disabled}
              onSelect={onSelectCamera}
            />
            <Button
              aria-label={`Playback speed ${control.speed}x`}
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              disabled={disabled}
              onClick={() => onCommit(cycleGoogleRouteSpeed)}
              size="sm"
              title="Change playback speed"
              type="button"
              variant="outline"
            >
              <Gauge aria-hidden="true" />
              {control.speed}x
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplaySettings({
  control,
  onCommit,
  onSelectCamera,
  route,
  showFieldRoutes,
}: {
  control: GoogleRouteNavigatorState;
  onCommit: ReplayHudProps["onCommit"];
  onSelectCamera: ReplayHudProps["onSelectCamera"];
  route: QuestRoute;
  showFieldRoutes: boolean;
}) {
  return (
    <aside
      aria-label="Replay settings panel"
      className="absolute right-3 top-14 z-40 w-[min(21rem,calc(100%-1.5rem))] border border-white/18 bg-[#081011]/94 p-4 text-white shadow-2xl backdrop-blur-xl sm:right-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[9px] font-semibold uppercase text-[#ef684e]">
            Replay settings
          </div>
          <div className="mt-1 text-sm font-semibold">{route.region}</div>
        </div>
        <Settings2 aria-hidden="true" className="size-4 text-white/50" />
      </div>

      <div className="mt-4 grid gap-4">
        <SettingGroup icon={Mountain} label="Route placement">
          {(["ground", "mesh"] as const).map((mode) => (
            <SettingButton
              active={control.groundingMode === mode}
              key={mode}
              label={mode}
              onClick={() =>
                onCommit((current) => ({ ...current, groundingMode: mode }))
              }
            />
          ))}
        </SettingGroup>

        <SettingGroup icon={LocateFixed} label="Camera lock">
          <SettingButton
            active={control.following}
            label="Locked"
            onClick={() =>
              onCommit((current) => ({ ...current, following: true }))
            }
          />
          <SettingButton
            active={!control.following}
            label="Free"
            onClick={() =>
              onCommit((current) => ({ ...current, following: false }))
            }
          />
        </SettingGroup>

        <SettingGroup icon={Eye} label="Camera view">
          {REPLAY_CAMERA_MODES.map(({ label, mode }) => (
            <SettingButton
              active={control.cameraMode === mode}
              key={mode}
              label={mode === "auto" ? "Auto" : label}
              onClick={() => onSelectCamera(mode)}
            />
          ))}
        </SettingGroup>

        <SettingGroup icon={Gauge} label="Lens range">
          <Button
            aria-label="Zoom in"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={() =>
              onCommit((current) => zoomGoogleRouteNavigator(current, "in"))
            }
            size="icon-sm"
            title="Zoom in"
            type="button"
            variant="outline"
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            aria-label="Zoom out"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={() =>
              onCommit((current) => zoomGoogleRouteNavigator(current, "out"))
            }
            size="icon-sm"
            title="Zoom out"
            type="button"
            variant="outline"
          >
            <ZoomOut aria-hidden="true" />
          </Button>
        </SettingGroup>

        {showFieldRoutes ? (
          <div className="border-t border-white/12 pt-3">
            <div className="text-[9px] font-semibold uppercase text-white/42">
              Field routes
            </div>
            <div className="mt-2 flex gap-2">
              {FIELD_TEST_ROUTES.map((candidate) => (
                <Button
                  asChild
                  className={cn(
                    "h-8 border-white/20 bg-transparent text-white hover:bg-white/10",
                    candidate.slug === route.slug &&
                      "border-[#ef684e] text-[#ff8a73]",
                  )}
                  key={candidate.slug}
                  size="sm"
                  variant="outline"
                >
                  <Link to={`/lab/google-route-navigator/${candidate.slug}`}>
                    {candidate.label}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function SettingGroup({
  children,
  icon: Icon,
  label,
}: {
  children: React.ReactNode;
  icon: typeof Mountain;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-white/58">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </div>
      <div className="flex border border-white/15 bg-black/25 p-0.5">
        {children}
      </div>
    </div>
  );
}

function SettingButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label === "Locked" ? "Resume following" : label}
      aria-pressed={active}
      className={cn(
        "min-h-7 px-2.5 text-[11px] font-medium capitalize",
        active ? "bg-white text-black" : "text-white/58 hover:bg-white/10",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ReplayButton({
  disabled,
  onClick,
  playing,
  tone = "intelligence",
}: {
  disabled: boolean;
  onClick: () => void;
  playing: boolean;
  tone?: "intelligence" | "story";
}) {
  return (
    <Button
      aria-label={playing ? "Pause route" : "Play route"}
      className={cn(
        "border",
        tone === "story"
          ? "rounded-full border-[#ffcfb3] bg-[#ffdfca] text-[#1d2946] hover:bg-[#ffd2b5]"
          : "border-[#ef684e] bg-[#ef684e] text-black hover:bg-[#ff826c]",
      )}
      disabled={disabled}
      onClick={onClick}
      size="icon"
      type="button"
    >
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </Button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="whitespace-nowrap text-[11px] font-semibold tabular-nums">
        {value}
      </div>
      <div className="whitespace-nowrap text-[8px] font-semibold uppercase text-white/38">
        {label}
      </div>
    </div>
  );
}

interface ReplayHudProps {
  control: GoogleRouteNavigatorState;
  disabled: boolean;
  onCommit: (
    update: (current: GoogleRouteNavigatorState) => GoogleRouteNavigatorState,
  ) => void;
  onSelectCamera: (mode: GoogleRouteCameraMode) => void;
  onTogglePlayback: () => void;
  route: QuestRoute;
  telemetry: ReturnType<typeof googleRouteTelemetry>;
  totalDistanceM: number;
}
