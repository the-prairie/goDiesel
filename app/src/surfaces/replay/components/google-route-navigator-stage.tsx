import { YourMarkerSettings } from "./your-marker-settings";
import {
  ArrowLeft,
  Eye,
  Gauge,
  LocateFixed,
  MapPinned,
  Mountain,
  Navigation,
  Pause,
  Play,
  ScanLine,
  Settings2,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ReplayElevationScrubber } from "@/surfaces/replay/components/replay-elevation-scrubber";
import { ReplayChapterControls } from "@/surfaces/replay/components/replay-chapter-controls";
import { ReplayRoutePicker } from "@/surfaces/replay/components/replay-route-picker";
import { Button } from "@/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/ui/sheet";
import "./immersive-replay.css";
import { CLIMB_NOT_RECORDED, recordedClimbM, type QuestRoute, type RouteSummary } from "@/domain/route";
import { cn } from "@/ui/utils";
import {
  googleRouteCameraPose,
  googleRouteTelemetry,
  type GoogleRouteCameraMode,
  type GoogleRouteNavigatorState,
} from "@/surfaces/replay/playback/route-navigator-controller";
import type { ReplaySessionEvent } from "@/surfaces/replay/playback/replay-session-state";
import {
  initialReplayChapterControlsState,
  reduceReplayChapterControls,
  type ReplayChapterControlsEvent,
} from "@/surfaces/replay/playback/replay-chapter-controls-state";
import {
  googleReplayIntentEvents,
  type GoogleReplayIntent,
} from "@/surfaces/replay/playback/google-replay-stage-state";
import { useGoogleReplayDriver } from "@/surfaces/replay/playback/use-google-replay-driver";

// Lab-only shortcuts between the two field-test routes. A single-route
// microsite build folds this to an empty list so neither route ships with it.
const FIELD_TEST_ROUTES: ReadonlyArray<{ slug: string; label: string }> = import.meta.env
  .VITE_SINGLE_ROUTE_SLUG
  ? []
  : [
      { slug: "14736711660", label: "San Francisco" },
      { slug: "14023448720", label: "Crete" },
    ];


const CAMERA_MODES: Array<{
  mode: GoogleRouteCameraMode;
  label: string;
  icon: typeof Navigation;
}> = [
  { mode: "auto", label: "Auto director", icon: Sparkles },
  { mode: "runner", label: "Runner", icon: Navigation },
  { mode: "chase", label: "Chase", icon: Eye },
  { mode: "overview", label: "Overview", icon: MapPinned },
];

const GOOGLE_3D_REJECTED_TITLE = "Google 3D is unavailable";
const GOOGLE_3D_REJECTED_MESSAGE =
  "Google is not serving photorealistic 3D to this site right now. Atlas replay plays the same recorded route on the map.";

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
  const {
    stageRef,
    containerRef,
    session,
    sessionRef,
    dispatchStage,
    commitControl,
    releaseCamera,
    totalDistanceM,
  } = useGoogleReplayDriver({
    route,
    camera: productionReplay ? "sustained" : "base",
    palette: productionReplay ? "immersive" : "neutral",
  });
  const { control, status, statusReason, settingsOpen, chaptersExpanded } = session;
  const providerUnavailable = status.state === "unavailable";
  // A rejected key is the site's problem, not the visitor's: production
  // Replay says so plainly; the lab keeps the diagnostic message.
  const keyRejected = productionReplay && providerUnavailable && statusReason === "authentication";
  const [chapterControls, dispatchChapterControls] = useReducer(reduceReplayChapterControls, undefined, initialReplayChapterControlsState);
  const telemetry = useMemo(
    () => googleRouteTelemetry(route, control.progressM),
    [control.progressM, route],
  );
  const cameraPose = useMemo(
    () => googleRouteCameraPose(route, control),
    [control, route],
  );

  // Each route starts its chapters afresh, as each starts a new session.
  useEffect(() => {
    dispatchChapterControls({ type: "routeReplaced" });
  }, [route]);

  const performIntent = useCallback(
    (intent: GoogleReplayIntent) => {
      const events = googleReplayIntentEvents(sessionRef.current, chapterControls, intent);
      for (const event of events.chapters) dispatchChapterControls(event);
      for (const event of events.control) commitControl(event);
    },
    [chapterControls, commitControl, sessionRef],
  );

  const togglePlayback = useCallback(() => performIntent({ type: "playbackToggled" }), [performIntent]);
  const browseChapter = (event: ReplayChapterControlsEvent) => performIntent({ type: "chapterBrowsed", event });
  const playFromPreview = () => performIntent({ type: "previewPlayed", totalDistanceM });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || settingsOpen ||
        (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      if (event.key === "Escape") {
        if (chaptersExpanded) dispatchStage({ type: "chaptersExpandedChanged", expanded: false });
        else navigate(backPath);
      }
      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backPath, chaptersExpanded, dispatchStage, navigate, settingsOpen, togglePlayback]);

  const selectCamera = (mode: GoogleRouteCameraMode) =>
    commitControl({ type: "cameraSelected", cameraMode: mode });

  return (
    <section
      ref={stageRef}
      aria-label={
        productionReplay ? "Google 3D Replay" : "Google route navigator lab"
      }
      className={cn(
        "fixed right-0 top-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-canvas",
        productionReplay
          ? "immersive-replay z-[var(--z-map-controls)] inset-0"
          : "z-[var(--z-navigation)] bottom-0 left-0",
      )}
      data-camera-mode={control.cameraMode}
      data-camera-entrance={status.state === "ready" ? "tracking" : "waiting"}
      data-camera-clearance-m={cameraPose.clearanceM?.toFixed(2)}
      data-camera-clearance-source="base-plan-recorded-terrain"
      data-minimum-camera-clearance-m={cameraPose.minimumClearanceM?.toFixed(2)}
      data-camera-protection={cameraPose.protection?.join(" ") ?? "manual"}
      data-directed-camera={cameraPose.directedMode ?? control.cameraMode}
      data-following={control.following}
      data-grounding-mode={control.groundingMode}
      data-hud-state={productionReplay && !chaptersExpanded ? "compact" : "expanded"}
      data-engine="google-3d-maps"
      data-route-slug={route.slug}
      data-state={status.state}
      data-testid={productionReplay ? "replay-stage" : "google-route-navigator"}
    >
      {/* The map host is its own stacking context, so nothing Google injects
          (such as its key-error dialog) can rise above the stage overlays.
          While the provider is unavailable it is hidden and inert. */}
      <div
        aria-hidden={providerUnavailable || undefined}
        aria-label={`Google photorealistic 3D view of ${route.name}`}
        data-testid="replay-map-host"
        inert={providerUnavailable || undefined}
        onPointerDownCapture={releaseCamera}
        onWheelCapture={releaseCamera}
        className={cn(
          productionReplay ? "absolute inset-0" : "relative min-h-0",
          "isolate",
          providerUnavailable && "invisible opacity-0",
        )}
        ref={containerRef}
      />

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(0,0,0,.42)_0%,transparent_22%,transparent_70%,rgba(0,0,0,.52)_100%)]" />

      <header className={cn("replay-header pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 py-3 text-white sm:p-6", !productionReplay && "bg-black/42 backdrop-blur-md")}>

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
          <div className="min-w-0">
            <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-[.14em] text-white/75">{route.region}</p>
            <h1 className="line-clamp-2 text-sm font-semibold sm:text-xl" title={route.name}>{route.name}</h1>
            <div className="truncate text-[11px] text-white/58">
              {route.distanceKm.toFixed(1)} km ·{" "}
              {recordedClimbM(route) === null
                ? CLIMB_NOT_RECORDED
                : `${Math.round(route.elevationGainM)} m up`}{" "}
              · {route.type}
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Sheet open={settingsOpen} onOpenChange={open => dispatchStage({ type: "settingsOpenChanged", open })}>
            <SheetTrigger asChild>
              <Button aria-label="Replay settings" className="border border-white/20 bg-black/35 text-white hover:bg-black/60" size="icon" type="button" variant="ghost">
                <Settings2 aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[min(24rem,100vw)] overflow-y-auto">
              <SheetHeader className="pr-12">
                <SheetTitle>Replay settings</SheetTitle>
                <SheetDescription>{route.region}. Camera, route placement and zoom.</SheetDescription>
              </SheetHeader>
              <ReplaySettings control={control} disabled={status.state !== "ready"} onCommit={commitControl} route={route} showFieldRoutes={!productionReplay} telemetry={telemetry} />
            </SheetContent>
          </Sheet>
          {productionReplay && pickerRoutes.length > 0 ? (
            <div className="min-w-0 text-ink">
              <ReplayRoutePicker
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

      {status.state !== "ready" ? (
        // Opaque, under the header and dock: nothing from the map host shows.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 bg-canvas"
          data-testid="replay-provider-backdrop"
        />
      ) : null}
      {status.state !== "ready" ? (
        <div className={cn("pointer-events-none absolute inset-0 grid place-items-center pt-[calc(1.5rem+var(--safe-area-top))] pr-[calc(1.5rem+var(--safe-area-right))] pb-[calc(1.5rem+var(--safe-area-bottom))] pl-[calc(1.5rem+var(--safe-area-left))]", providerUnavailable ? "z-40" : "z-20")}>
          <div
            aria-live="polite"
            className="pointer-events-auto max-h-full max-w-md overflow-y-auto border border-white/20 bg-surface p-6 text-center text-white"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine
              aria-hidden="true"
              className="mx-auto size-5 text-accent-foreground"
            />
            <h2 className="mt-3 font-editorial text-2xl font-semibold">
              {status.state === "loading"
                ? "Entering the route"
                : keyRejected
                  ? GOOGLE_3D_REJECTED_TITLE
                  : "3D world unavailable"}
            </h2>
            <p className="mt-2 text-sm text-white/62">
              {keyRejected ? GOOGLE_3D_REJECTED_MESSAGE : status.message}
            </p>
            {status.state === "unavailable" && onUseAtlas ? (
              <Button
                className="mt-5 bg-primary text-primary-foreground hover:bg-primary-hover"
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
        hidden={settingsOpen}
        className={cn("pointer-events-none z-30", productionReplay ? "immersive-replay-dock" : "relative")}
        data-testid={productionReplay ? "replay-controls" : undefined}
      >
        {productionReplay ? <ReplayChapterControls
          key={route.slug}
          route={route}
          state={chapterControls}
          progressM={control.progressM}
          playing={control.playing}
          speed={control.speed}
          disabled={status.state !== "ready"}
          expanded={chaptersExpanded}
          onExpandedChange={expanded => dispatchStage({ type: "chaptersExpandedChanged", expanded })}
          onEvent={browseChapter}
          onPlayFromPreview={playFromPreview}
          onTogglePlayback={togglePlayback}
          onSeek={progressM => performIntent({ type: "seekRequested", progressM, totalDistanceM })}
          onCycleSpeed={() => commitControl({ type: "speedCycled" })}
          metrics={<div className="replay-metrics grid grid-cols-4 gap-2">
            <Metric label={route.route.some(point => point.elapsedS !== undefined) ? "Elapsed" : "Elapsed · derived"} value={route.provenance.temporal.status === "recorded" ? formatDuration(telemetry.elapsedS) : "Unavailable"} />
            <Metric label={route.type.toLowerCase().includes("ride") ? "Speed" : "Pace"} value={route.provenance.temporal.status === "recorded" ? formatPace(telemetry.paceSPerKm, route.type) : "Unavailable"} />
            <Metric label="Elevation" value={`${Math.round(telemetry.elevationM)} m`} />
            <Metric label="Grade" value={`${telemetry.gradePercent >= 0 ? "+" : ""}${telemetry.gradePercent.toFixed(1)}%`} />
          </div>}
        /> : <ReplayHud
          control={control}
          disabled={status.state !== "ready"}
          onCommit={commitControl}
          onSelectCamera={selectCamera}
          onTogglePlayback={togglePlayback}
          route={route}
          telemetry={telemetry}
          totalDistanceM={totalDistanceM}
        />}
      </div>
    </section>
  );
}

function ReplayHud({
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
      className="pointer-events-auto mx-auto w-full border-t border-white/15 bg-surface/98 text-white backdrop-blur"
      data-testid="google-route-controls"
    >
      <div className="grid grid-cols-[12rem_minmax(0,1fr)] md:grid-cols-[13rem_minmax(0,1fr)] lg:min-h-28 2xl:grid-cols-[13rem_minmax(14rem,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2 border-r border-white/12 px-3 py-2 md:gap-3 md:px-4 md:py-3">
          <ReplayButton
            disabled={disabled}
            onClick={onTogglePlayback}
            playing={control.playing}
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-accent-foreground">
              Route progress
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
            onCommit({ type: "progressSelected", progressM, totalDistanceM })
          }
          progressM={control.progressM}
          route={route}
          tone="intelligence"
          totalDistanceM={totalDistanceM}
        />

        <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-white/12 px-3 py-2 2xl:col-span-1 2xl:min-w-[27rem] 2xl:border-l 2xl:border-t-0 2xl:px-4">
          <div className="replay-metrics grid min-w-0 flex-1 grid-cols-4 gap-x-2 sm:gap-x-5">
            <Metric
              label="Elapsed"
              value={formatDuration(telemetry.elapsedS)}
            />
            <Metric
              label="Pace"
              value={formatPace(telemetry.paceSPerKm, route.type)}
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
            <div className="hidden sm:block">
              <CameraControls
                active={control.cameraMode}
                disabled={disabled}
                onSelect={onSelectCamera}
              />
            </div>
            <Button
              aria-label={`Playback speed ${control.speed}x`}
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              disabled={disabled}
              onClick={() => onCommit({ type: "speedCycled" })}
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
  disabled,
  onCommit,
  route,
  showFieldRoutes,
  telemetry,
}: {
  control: GoogleRouteNavigatorState;
  disabled: boolean;
  onCommit: ReplayHudProps["onCommit"];
  route: QuestRoute;
  showFieldRoutes: boolean;
  telemetry: ReplayHudProps["telemetry"];
}) {
  return (
    <div className="min-w-0 px-4 pb-6">
      <div className="grid gap-4">
        <fieldset disabled={disabled} className="grid min-w-0 gap-4 disabled:opacity-50">
          <legend className="sr-only">Replay controls</legend>
          <div>
            <p className="mb-2 text-xs text-white/70">Camera perspective</p>
            <CameraControls active={control.cameraMode} disabled={disabled} onSelect={cameraMode => onCommit({ type: "cameraSelected", cameraMode })} />
          </div>
          <SettingGroup icon={Mountain} label="Route placement">
            {(["ground", "mesh"] as const).map((mode) => (
              <SettingButton
                active={control.groundingMode === mode}
                key={mode}
                label={mode === "ground" ? "On terrain" : "On 3D surface"}
                onClick={() =>
                  onCommit({ type: "groundingSelected", groundingMode: mode })
                }
              />
            ))}
          </SettingGroup>

          <p className="-mt-2 text-xs leading-5 text-ink-muted">On terrain follows the ground. On 3D surface follows the available buildings and terrain model.</p>
          <SettingGroup icon={LocateFixed} label="Camera movement">
            <SettingButton
              active={control.following}
              label="Follow route"
              onClick={() =>
                onCommit({ type: "followingChanged", following: true })
              }
            />
            <SettingButton
              active={!control.following}
              label="Explore freely"
              onClick={() =>
                onCommit({ type: "followingChanged", following: false })
              }
            />
          </SettingGroup>

          <SettingGroup icon={Gauge} label="Zoom">
            <Button
              aria-label="Zoom in"
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={() =>
                onCommit({ type: "zoomRequested", direction: "in" })
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
                onCommit({ type: "zoomRequested", direction: "out" })
              }
              size="icon-sm"
              title="Zoom out"
              type="button"
              variant="outline"
            >
              <ZoomOut aria-hidden="true" />
            </Button>
          </SettingGroup>
        </fieldset>
        <YourMarkerSettings />
        <div className="grid grid-cols-2 gap-3 border-t border-white/15 pt-4" aria-label="Recorded telemetry">
          <Metric label="Elapsed" value={formatDuration(telemetry.elapsedS)} />
          <Metric label={route.type.toLowerCase().includes("ride") ? "Speed" : "Pace"} value={formatPace(telemetry.paceSPerKm, route.type)} />
          <Metric label="Elevation" value={`${Math.round(telemetry.elevationM)} m`} />
          <Metric label="Grade" value={`${telemetry.gradePercent >= 0 ? "+" : ""}${telemetry.gradePercent.toFixed(1)}%`} />
        </div>
        {showFieldRoutes ? (
          <div className="border-t border-white/12 pt-3">
            <div className="text-xs font-semibold uppercase text-ink-muted">
              Field routes
            </div>
            <div className="mt-2 flex gap-2">
              {FIELD_TEST_ROUTES.map((candidate) => (
                <Button
                  asChild
                  className={cn(
                    "h-8 border-white/20 bg-transparent text-white hover:bg-white/10",
                    candidate.slug === route.slug &&
                      "border-[#f5f5f5] text-[#ffffff]",
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
    </div>
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
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-xs text-white/58">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </div>
      <div className="ember-segments">
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
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-3px]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function CameraControls({
  active,
  disabled,
  onSelect,
}: {
  active: GoogleRouteCameraMode;
  disabled: boolean;
  onSelect: (mode: GoogleRouteCameraMode) => void;
}) {
  return (
    <div
      aria-label="Camera perspective"
      className="ember-segments ember-camera"
      role="group"
    >
      {CAMERA_MODES.map(({ mode, label, icon: Icon }) => (
        <button
          aria-label={label}
          aria-pressed={active === mode}
          className={cn(
            "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md px-2 text-ink-secondary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-3px]",
          )}
          disabled={disabled}
          key={mode}
          onClick={() => onSelect(mode)}
          title={`${label} camera`}
          type="button"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span className="text-xs">{mode === "auto" ? "Auto" : label}</span>
        </button>
      ))}
    </div>
  );
}

function ReplayButton({
  disabled,
  onClick,
  playing,
}: {
  disabled: boolean;
  onClick: () => void;
  playing: boolean;
}) {
  return (
    <Button
      aria-label={playing ? "Pause route" : "Play route"}
      className="border border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
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
      <div className="whitespace-nowrap text-[10px] sm:text-[11px] font-semibold tabular-nums">
        {value}
      </div>
      <div className="whitespace-nowrap text-[10px] font-medium text-white/65">
        {label}
      </div>
    </div>
  );
}

interface ReplayHudProps {
  control: GoogleRouteNavigatorState;
  disabled: boolean;
  onCommit: (event: ReplaySessionEvent) => void;
  onSelectCamera: (mode: GoogleRouteCameraMode) => void;
  onTogglePlayback: () => void;
  route: QuestRoute;
  telemetry: ReturnType<typeof googleRouteTelemetry>;
  totalDistanceM: number;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPace(paceSPerKm: number | undefined, activityType: string) {
  if (paceSPerKm === undefined || !Number.isFinite(paceSPerKm)) return "--";
  if (activityType.toLowerCase().includes("ride")) {
    const speedKmh = 3_600 / paceSPerKm;
    return `${speedKmh.toFixed(1)} km/h`;
  }
  return `${formatDuration(paceSPerKm)} /km`;
}
