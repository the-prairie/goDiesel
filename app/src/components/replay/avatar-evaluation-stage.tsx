import {
  DotLottieReact,
  setWasmUrl as setDotLottieWasmUrl,
  type DotLottie,
} from "@lottiefiles/dotlottie-react";
import {
  Alignment,
  Fit,
  Layout,
  Rive,
  RuntimeLoader,
} from "@rive-app/canvas-lite";
import {
  Accessibility,
  ArrowLeft,
  Gauge,
  Pause,
  Play,
  Route,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { QuestRoute, RouteSummary } from "@/domain/routes";
import { cn } from "@/lib/utils";
import { avatarEvaluationLabPath, replayPath } from "@/navigation";
import {
  advanceReplay,
  cycleReplaySpeed,
  initialReplayState,
  replayPose,
  routeDistanceM,
  seekReplay,
  type ReplayControlState,
} from "@/replay/replay-controller";
import {
  CesiumReplayEngine,
  type CesiumReplayAvatarRendering,
  type CesiumReplayAvatarStatus,
} from "@/replay/cesium/cesium-replay-engine";
import type { ReplayEngine, ReplayStatus } from "@/replay/replay-engine";

export type AvatarEvaluationSystem = "dotlottie" | "cesium-glb" | "rive";

interface AvatarSyncState {
  progressM: number;
  playing: boolean;
  reducedMotion: boolean;
  speed: number;
}

interface AvatarRendererHandle {
  sync(state: AvatarSyncState): void;
}

interface AvatarRendererCapability {
  timeline: string;
  animationCount?: number;
  stateMachineCount?: number;
}

type EvaluationReplayEngine = ReplayEngine & {
  setAvatarRendering?: (
    rendering: CesiumReplayAvatarRendering,
  ) => Promise<CesiumReplayAvatarStatus>;
};

declare global {
  interface Window {
    __GODIESEL_AVATAR_EVALUATION_ENGINE_FACTORY__?: (
      system: AvatarEvaluationSystem,
    ) => EvaluationReplayEngine | undefined;
  }
}

const systems: Array<{
  id: AvatarEvaluationSystem;
  shortLabel: string;
  label: string;
  placement: string;
  control: string;
}> = [
  {
    id: "dotlottie",
    shortLabel: "Lottie",
    label: "Custom dotLottie",
    placement: "Screen overlay",
    control: "Exact frame sync",
  },
  {
    id: "cesium-glb",
    shortLabel: "GLB",
    label: "Native Cesium GLB",
    placement: "World primitive",
    control: "Distance-driven animation",
  },
  {
    id: "rive",
    shortLabel: "Rive",
    label: "Rive Canvas Lite",
    placement: "Canvas overlay",
    control: "Exact timeline scrub",
  },
];

const cameraPresets = [
  { label: "Near", rangeM: 120 },
  { label: "Mid", rangeM: 720 },
  { label: "Far", rangeM: 1_400 },
] as const;

setDotLottieWasmUrl("/dotlottieStatic/dotlottie-player.wasm");

function initialStatus(): ReplayStatus {
  return {
    state: "loading",
    title: "Building the evaluation world",
    message: "Preparing the route and selected avatar renderer.",
  };
}

function createEvaluationEngine(
  system: AvatarEvaluationSystem,
  reducedMotion: boolean,
) {
  const injected = window.__GODIESEL_AVATAR_EVALUATION_ENGINE_FACTORY__?.(system);
  if (injected) return injected;
  return new CesiumReplayEngine(
    undefined,
    system === "cesium-glb"
      ? {
          avatarRendering: {
            kind: "native-glb",
            uri: "/avatar-lab/CesiumMan.glb",
            reducedMotion,
          },
        }
      : { avatarRendering: { kind: "overlay" } },
  );
}

export function AvatarEvaluationStage({
  route,
  routes,
}: {
  route: QuestRoute;
  routes: RouteSummary[];
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarElementRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EvaluationReplayEngine | undefined>(undefined);
  const rendererRef = useRef<AvatarRendererHandle | undefined>(undefined);
  const controlRef = useRef(initialReplayState());
  const [control, setControl] = useState(controlRef.current);
  const [status, setStatus] = useState<ReplayStatus>(initialStatus);
  const [system, setSystem] = useState<AvatarEvaluationSystem>("dotlottie");
  const systemRef = useRef<AvatarEvaluationSystem>(system);
  const [rendererState, setRendererState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [rendererCapability, setRendererCapability] = useState<AvatarRendererCapability>(
    () => ({ timeline: systems[0].control }),
  );
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const totalDistanceM = routeDistanceM(route);
  const operational = status.state === "ready" || status.state === "partial";
  const selectedSystem = systems.find((candidate) => candidate.id === system)!;
  systemRef.current = system;

  const syncRenderer = useCallback(
    (next: ReplayControlState) => {
      rendererRef.current?.sync({
        progressM: next.progressM,
        playing: next.playing,
        reducedMotion,
        speed: next.speed,
      });
    },
    [reducedMotion],
  );

  const commitControl = useCallback(
    (update: (current: ReplayControlState) => ReplayControlState) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      engineRef.current?.setPose(replayPose(route, next));
      syncRenderer(next);
    },
    [route, syncRenderer],
  );

  useEffect(() => {
    const container = containerRef.current;
    const avatarElement = avatarElementRef.current;
    if (!container || !avatarElement) return;
    const engine = createEvaluationEngine(system, reducedMotion);
    engineRef.current = engine;
    controlRef.current = initialReplayState();
    setControl(controlRef.current);
    setStatus(initialStatus());
    void engine.mount({
      container,
      avatarElement,
      route,
      onStatus: (nextStatus) => {
        if (engineRef.current !== engine) return;
        setStatus(nextStatus);
        if (nextStatus.state === "ready" || nextStatus.state === "partial") {
          engine.setPose(replayPose(route, controlRef.current));
          if (systemRef.current === "cesium-glb") {
            setRendererState(
              container.dataset.avatarAnimation === "error" ? "error" : "ready",
            );
          }
        }
        if (nextStatus.state === "unavailable") setRendererState("error");
      },
    });
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [route]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let active = true;
    rendererRef.current = undefined;
    setRendererState("loading");
    setRendererCapability({ timeline: selectedSystem.control });
    const rendering: CesiumReplayAvatarRendering =
      system === "cesium-glb"
        ? {
            kind: "native-glb",
            uri: "/avatar-lab/CesiumMan.glb",
            reducedMotion,
          }
        : { kind: "overlay" };
    void engine.setAvatarRendering?.(rendering).then((result) => {
      if (!active || systemRef.current !== system || system !== "cesium-glb") {
        return;
      }
      if (result === "ready" || result === "static") setRendererState("ready");
      if (result === "error") setRendererState("error");
    });
    if (!engine.setAvatarRendering && system === "cesium-glb") {
      setRendererState("ready");
    }
    syncRenderer(controlRef.current);
    return () => {
      active = false;
    };
  }, [reducedMotion, selectedSystem.control, syncRenderer, system]);

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
      syncRenderer(next);
      if (now - lastUiUpdate >= 80) {
        setControl(next);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [control.playing, operational, route, syncRenderer, totalDistanceM]);

  const setRendererHandle = useCallback(
    (
      handle: AvatarRendererHandle | undefined,
      state: "ready" | "error",
      capability?: AvatarRendererCapability,
    ) => {
      rendererRef.current = handle;
      setRendererState(state);
      if (capability) setRendererCapability(capability);
      if (handle) syncRenderer(controlRef.current);
    },
    [syncRenderer],
  );

  return (
    <section
      aria-label="Avatar evaluation lab"
      data-testid="avatar-evaluation-stage"
      data-system={system}
      data-state={status.state}
      data-renderer-state={rendererState}
      data-progress={control.progressM.toFixed(2)}
      data-speed={control.speed}
      data-camera-range={control.cameraRangeM}
      data-reduced-motion={reducedMotion}
      data-renderer-timeline={rendererCapability.timeline}
      data-renderer-animation-count={rendererCapability.animationCount ?? ""}
      data-renderer-state-machine-count={rendererCapability.stateMachineCount ?? ""}
      className="relative h-[calc(100dvh-3.5rem)] min-h-[36rem] overflow-hidden bg-[#02070a]"
    >
      <div
        ref={containerRef}
        aria-label="Avatar evaluation world"
        className="absolute inset-0"
      />
      <div
        ref={avatarElementRef}
        role="img"
        aria-label={`${selectedSystem.label} route avatar`}
        className="pointer-events-none absolute left-0 top-0 z-10 hidden size-20 drop-shadow-[0_8px_5px_rgba(0,0,0,0.55)]"
      >
        <div className="absolute bottom-1 left-1/2 h-3 w-12 -translate-x-1/2 rounded-[50%] bg-black/45 blur-sm" />
        {system === "dotlottie" ? (
          <DotLottieEvaluationAvatar onRenderer={setRendererHandle} />
        ) : null}
        {system === "rive" ? (
          <RiveEvaluationAvatar onRenderer={setRendererHandle} />
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-5">
        <div className="pointer-events-auto w-full max-w-xl rounded-md border border-border bg-background/92 p-3 shadow-2xl backdrop-blur sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
              <Accessibility className="size-4" aria-hidden="true" />
              Avatar evaluation lab
            </div>
            <Button asChild variant="ghost" size="icon" className="size-9">
              <Link to={replayPath(route.slug)} aria-label="Exit avatar lab" title="Exit lab">
                <ArrowLeft aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{route.name}</h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                One world, three rendering systems
              </p>
            </div>
            <label className="shrink-0 text-xs text-muted-foreground">
              <span className="sr-only">Evaluation route</span>
              <select
                aria-label="Evaluation route"
                value={route.slug}
                onChange={(event) =>
                  navigate(avatarEvaluationLabPath(event.currentTarget.value))
                }
                className="h-9 max-w-40 rounded-sm border border-border bg-background px-2 text-foreground outline-none focus:ring-2 focus:ring-ring sm:max-w-56"
              >
                {routes.map((candidate) => (
                  <option key={candidate.slug} value={candidate.slug}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            role="tablist"
            aria-label="Avatar rendering system"
            className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
          >
            {systems.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={candidate.id === system}
                onClick={() => setSystem(candidate.id)}
                className="min-h-11 rounded-sm px-2 text-xs font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-primary aria-selected:text-primary-foreground sm:text-sm"
              >
                <span className="sm:hidden">{candidate.shortLabel}</span>
                <span className="hidden sm:inline">{candidate.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {status.state === "loading" ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
          <div role="status" className="rounded-md border border-border bg-background/92 p-5 text-center shadow-2xl">
            <div className="font-semibold">{status.title}</div>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">{status.message}</p>
          </div>
        </div>
      ) : null}

      <aside className="pointer-events-none absolute bottom-32 right-5 z-20 hidden w-64 rounded-md border border-border bg-background/90 p-4 shadow-2xl backdrop-blur md:block">
        <div className="text-xs font-semibold uppercase text-primary">
          {selectedSystem.label}
        </div>
        <dl className="mt-3 grid gap-3 text-sm">
          <Metric label="Placement" value={selectedSystem.placement} />
          <Metric label="Timeline" value={rendererCapability.timeline} />
          <Metric
            label="Renderer"
            value={rendererState === "ready" ? "Ready" : rendererState}
          />
          <Metric label="Asset" value="Bundled locally" />
        </dl>
      </aside>

      <div className="absolute inset-x-3 bottom-3 z-30 rounded-md border border-border bg-background/95 p-2 shadow-2xl backdrop-blur sm:inset-x-5 sm:p-3">
        <div className="flex items-center gap-3">
          <Route className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground sm:w-32 sm:text-sm">
            {(control.progressM / 1_000).toFixed(2)} / {(totalDistanceM / 1_000).toFixed(1)} km
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, totalDistanceM)}
            step={1}
            value={control.progressM}
            disabled={!operational}
            aria-label="Avatar evaluation progress"
            onChange={(event) =>
              commitControl((current) =>
                seekReplay(current, Number(event.currentTarget.value), totalDistanceM),
              )
            }
            className="h-11 min-w-0 flex-1 accent-emerald-400"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button
            type="button"
            size="icon"
            className="size-11"
            disabled={!operational}
            aria-label={control.playing ? "Pause avatar evaluation" : "Play avatar evaluation"}
            onClick={() => commitControl((current) => ({ ...current, playing: !current.playing }))}
          >
            {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!operational}
            aria-label={`Evaluation playback speed ${control.speed}x`}
            onClick={() => commitControl(cycleReplaySpeed)}
          >
            <Gauge aria-hidden="true" />
            {control.speed}x
          </Button>
          <div className="flex h-11 items-center rounded-md border border-border p-1">
            {cameraPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={!operational}
                aria-pressed={control.cameraRangeM === preset.rangeM}
                onClick={() =>
                  commitControl((current) => ({
                    ...current,
                    cameraRangeM: preset.rangeM,
                  }))
                }
                className="h-9 min-w-12 rounded-sm px-2 text-xs font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-secondary aria-pressed:text-primary"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className={cn("h-11", reducedMotion && "border-primary text-primary")}
            aria-pressed={reducedMotion}
            onClick={() => setReducedMotion((current) => !current)}
          >
            <Accessibility aria-hidden="true" />
            <span className="hidden sm:inline">Reduced motion</span>
            <span className="sm:hidden">Motion</span>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function DotLottieEvaluationAvatar({
  onRenderer,
}: {
  onRenderer: (
    handle: AvatarRendererHandle | undefined,
    state: "ready" | "error",
    capability?: AvatarRendererCapability,
  ) => void;
}) {
  const [instance, setInstance] = useState<DotLottie | null>(null);

  useEffect(() => {
    if (!instance) return;
    const sync = (state: AvatarSyncState) => {
      const totalFrames = Math.max(1, instance.totalFrames);
      const phase = state.reducedMotion ? 0.18 : (state.progressM / 2.8) % 1;
      instance.pause();
      instance.setSpeed(state.speed);
      instance.setFrame(Math.min(totalFrames - 1, Math.floor(phase * totalFrames)));
    };
    const ready = () =>
      onRenderer({ sync }, "ready", { timeline: "Exact frame sync" });
    const failed = () => onRenderer(undefined, "error");
    instance.addEventListener("load", ready);
    instance.addEventListener("loadError", failed);
    if (instance.totalFrames > 0) ready();
    return () => {
      instance.removeEventListener("load", ready);
      instance.removeEventListener("loadError", failed);
    };
  }, [instance, onRenderer]);

  return (
    <DotLottieReact
      src="/route-avatars/hangout-running.lottie"
      autoplay={false}
      loop
      dotLottieRefCallback={setInstance}
      className="relative size-full"
    />
  );
}

function RiveEvaluationAvatar({
  onRenderer,
}: {
  onRenderer: (
    handle: AvatarRendererHandle | undefined,
    state: "ready" | "error",
    capability?: AvatarRendererCapability,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    RuntimeLoader.setWasmUrl("/riveStatic/rive.wasm");
    RuntimeLoader.setWasmFallbackUrl(null);
    let disposed = false;
    let rive: Rive | undefined;
    rive = new Rive({
      src: "/avatar-lab/vehicles.riv",
      canvas,
      autoplay: false,
      enableRiveAssetCDN: false,
      shouldDisableRiveListeners: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        if (disposed || !rive) return;
        rive.resizeDrawingSurfaceToCanvas(Math.min(window.devicePixelRatio, 1.5));
        const animation = rive.animationNames[0];
        const animationCount = rive.animationNames.length;
        const stateMachineCount = rive.stateMachineNames.length;
        const sync = (state: AvatarSyncState) => {
          if (!rive || !animation) return;
          const duration = Math.max(0.001, rive.durations[0] ?? 1);
          const phase = state.reducedMotion ? 0.18 : (state.progressM / 2.8) % 1;
          rive.pause(animation);
          rive.scrub(animation, phase * duration);
          canvas.dataset.frame = (phase * duration).toFixed(3);
        };
        onRenderer(
          { sync },
          "ready",
          {
            timeline: animation ? "Exact timeline scrub" : "No linear timeline",
            animationCount,
            stateMachineCount,
          },
        );
      },
      onLoadError: () => {
        if (!disposed) onRenderer(undefined, "error");
      },
    });
    return () => {
      disposed = true;
      rive?.cleanup();
    };
  }, [onRenderer]);

  return <canvas ref={canvasRef} className="relative size-full" />;
}
