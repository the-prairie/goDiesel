import {
  ArrowLeft,
  Eye,
  Gauge,
  LocateFixed,
  LockKeyhole,
  MapPinned,
  Mountain,
  Navigation,
  Pause,
  Play,
  Route,
  ScanLine,
  Settings2,
  Sparkles,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ReplayElevationScrubber } from "@/components/replay/replay-elevation-scrubber";
import { ReplayRoutePicker } from "@/components/replay/replay-route-picker";
import { Button } from "@/components/ui/button";
import type { QuestRoute, RouteSummary } from "@/domain/routes";
import { cn } from "@/lib/utils";
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
  { mode: "auto", label: "Auto director", icon: Sparkles },
  { mode: "runner", label: "Runner", icon: Navigation },
  { mode: "chase", label: "Chase", icon: Eye },
  { mode: "overview", label: "Overview", icon: MapPinned },
];

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
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const controlRef = useRef(initialGoogleRouteNavigatorState());
  const [control, setControl] = useState(controlRef.current);
  const [status, setStatus] = useState<GoogleRouteNavigatorStatus>(INITIAL_STATUS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const totalDistanceM = routeDistanceM(route);
  const telemetry = useMemo(
    () => googleRouteTelemetry(route, control.progressM),
    [control.progressM, route],
  );
  const cameraPose = useMemo(
    () => googleRouteCameraPose(route, control),
    [control, route],
  );

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
      engineRef.current?.setCinematicRoute(
        googleRouteThreadTreatment(route, next),
      );
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
    setSettingsOpen(false);
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
        outerWidth: 0.48,
        width: 6,
      },
      onStatus: (next) => {
        setStatus(next);
        if (next.state === "ready") {
          engine.setCamera(googleRouteCameraPose(route, controlRef.current));
          engine.setCinematicRoute(
            googleRouteThreadTreatment(route, controlRef.current),
          );
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
    let lastRouteUpdate = previous;
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
      if (now - lastRouteUpdate >= 120) {
        engineRef.current?.setCinematicRoute(
          googleRouteThreadTreatment(route, next),
        );
        lastRouteUpdate = now;
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
      aria-label={productionReplay ? "Google 3D Replay" : "Google route navigator lab"}
      className={cn(
        "fixed right-0 top-0 z-[100] min-h-[34rem] overflow-hidden bg-[#081112]",
        productionReplay
          ? "bottom-[var(--mobile-navigation-height)] left-0 md:bottom-0 md:left-[var(--spine-rail-width)] lg:left-[var(--spine-width)]"
          : "bottom-0 left-0",
      )}
      data-camera-mode={control.cameraMode}
      data-camera-protection={cameraPose.protection?.join(" ") ?? "manual"}
      data-directed-camera={cameraPose.directedMode ?? control.cameraMode}
      data-following={control.following}
      data-grounding-mode={control.groundingMode}
      data-hud-state="expanded"
      data-engine="google-3d-maps"
      data-route-slug={route.slug}
      data-state={status.state}
      data-testid={productionReplay ? "replay-stage" : "google-route-navigator"}
    >
      <div
        aria-label={`Google photorealistic 3D view of ${route.name}`}
        className="absolute inset-0"
        ref={containerRef}
      />

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(0,0,0,.42)_0%,transparent_22%,transparent_70%,rgba(0,0,0,.52)_100%)]" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between border-b border-white/15 bg-black/42 px-3 py-2 text-white backdrop-blur-md sm:px-5">
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
            <h1 className="truncate text-sm font-semibold">{route.region}</h1>
            <div className="truncate text-[11px] text-white/58">
              {route.distanceKm.toFixed(1)} km · {Math.round(route.elevationGainM)} m up ·{" "}
              {route.type}
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 border-r border-white/15 pr-3 text-[10px] font-semibold uppercase text-white/62 sm:flex">
            <ScanLine aria-hidden="true" className="size-3.5 text-[#ef684e]" />
            {productionReplay ? "Google 3D Replay" : "Field replay"}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/72">
            {control.following ? (
              <LockKeyhole aria-hidden="true" className="size-3.5" />
            ) : (
              <Unlock aria-hidden="true" className="size-3.5" />
            )}
            <span className="hidden sm:inline">
              {control.cameraMode === "auto"
                ? `Auto · ${cameraPose.directedMode === "overview" ? "Reveal" : "Follow"}`
                : CAMERA_MODES.find(({ mode }) => mode === control.cameraMode)?.label}
            </span>
          </div>
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
            <div className="min-w-36 text-ink">
              <ReplayRoutePicker
                currentSlug={route.slug}
                routes={pickerRoutes}
                returnPath={backPath.startsWith("/atlas") ? backPath : undefined}
              />
            </div>
          ) : null}
        </div>
      </header>

      {settingsOpen ? (
        <ReplaySettings
          control={control}
          onCommit={commitControl}
          route={route}
          showFieldRoutes={!productionReplay}
        />
      ) : null}

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/58 p-6">
          <div
            aria-live="polite"
            className="max-w-md border border-white/20 bg-[#0b1112]/94 p-6 text-center text-white shadow-2xl"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine aria-hidden="true" className="mx-auto size-5 text-[#ef684e]" />
            <h2 className="mt-3 font-editorial text-2xl font-semibold">
              {status.state === "loading" ? "Entering the route" : "3D world unavailable"}
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
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30"
        data-testid={productionReplay ? "replay-controls" : undefined}
      >
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
      </div>
    </section>
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
          <Route aria-hidden="true" className="hidden size-4 text-[#ef684e] md:block" />
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase text-[#ef684e]">
              Route telemetry
            </div>
            <div
              className="mt-0.5 truncate text-[11px] font-semibold tabular-nums md:text-sm"
              data-testid="google-route-progress"
            >
              {(control.progressM / 1_000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
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
            <Metric label="Elapsed" value={formatDuration(telemetry.elapsedS)} />
            <Metric label="Pace" value={formatPace(telemetry.paceSPerKm, route.type)} />
            <Metric label="Elevation" value={`${Math.round(telemetry.elevationM)} m`} />
            <Metric
              label="Grade"
              value={`${telemetry.gradePercent >= 0 ? "+" : ""}${telemetry.gradePercent.toFixed(1)}%`}
            />
          </div>
          <div className="flex items-center gap-2">
            <CameraControls
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
  route,
  showFieldRoutes,
}: {
  control: GoogleRouteNavigatorState;
  onCommit: ReplayHudProps["onCommit"];
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

        {showFieldRoutes ? <div className="border-t border-white/12 pt-3">
          <div className="text-[9px] font-semibold uppercase text-white/42">
            Field routes
          </div>
          <div className="mt-2 flex gap-2">
            {FIELD_TEST_ROUTES.map((candidate) => (
              <Button
                asChild
                className={cn(
                  "h-8 border-white/20 bg-transparent text-white hover:bg-white/10",
                  candidate.slug === route.slug && "border-[#ef684e] text-[#ff8a73]",
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
        </div> : null}
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
      <div className="flex border border-white/15 bg-black/25 p-0.5">{children}</div>
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
      className="flex border border-white/15 bg-black/25 p-0.5"
      role="group"
    >
      {CAMERA_MODES.map(({ mode, label, icon: Icon }) => (
        <button
          aria-label={label}
          aria-pressed={active === mode}
          className={cn(
            "grid size-8 place-items-center text-white/55 hover:bg-white/10 hover:text-white",
            active === mode && "bg-white text-black hover:bg-white hover:text-black",
          )}
          disabled={disabled}
          key={mode}
          onClick={() => onSelect(mode)}
          title={`${label} camera`}
          type="button"
        >
          <Icon aria-hidden="true" className="size-3.5" />
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
      className="border border-[#ef684e] bg-[#ef684e] text-black hover:bg-[#ff826c]"
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
    update: (
      current: GoogleRouteNavigatorState,
    ) => GoogleRouteNavigatorState,
  ) => void;
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
