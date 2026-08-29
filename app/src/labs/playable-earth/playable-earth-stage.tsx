import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Camera,
  Flag,
  Footprints,
  Gamepad2,
  Gauge,
  LocateFixed,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Route,
  ScanLine,
  Settings2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/ui/button";
import {
  RouteContextHud,
  type RouteContextHudState,
} from "@/surfaces/replay/components/route-context-hud";
import type { QuestRoute } from "@/domain/route";
import { useIsMobile } from "@/ui/use-mobile";
import {
  advancePlayableEarth,
  PLAYABLE_EARTH_CAMERA_RANGES_M,
  cyclePlayableEarthCameraMode,
  cyclePlayableEarthSpeed,
  initialPlayableEarthState,
  playableEarthPose,
  playableEarthWorldPose,
  routeDistanceM,
  seekPlayableEarth,
  setPlayableEarthMode,
  togglePlayableEarthGhost,
  togglePlayableEarthPlayback,
  zoomPlayableEarth,
  type PlayableEarthControlState,
  type PlayableEarthInput,
} from "@/labs/playable-earth/playable-earth-controller";
import {
  createPlayableEarthViewer,
  type PlayableEarthGroundingDebug,
  type PlayableEarthStatus,
  type PlayableEarthViewer,
} from "@/labs/playable-earth/playable-earth-viewer";
import {
  initialWorldPlayer,
  recoverWorldPlayer,
  rejoinWorldRoute,
  stepWorldPlayer,
  worldPlayerAtRouteProgress,
  type WorldMovementInput,
  type WorldPhysicsRuntime,
  type WorldPlayerState,
} from "@/world-packs/world-physics";

const INITIAL_STATUS: PlayableEarthStatus = {
  state: "loading",
  title: "Building your route world",
  message: "Preparing the experimental Earth viewer.",
};

const INITIAL_GROUNDING: PlayableEarthGroundingDebug = {
  source: "fallback",
  reason: "recorded",
};

const IDLE_WORLD_INPUT: WorldMovementInput = {
  forward: 0,
  strafe: 0,
  turn: 0,
  run: false,
};

function signedAxis(value: number | undefined): -1 | 0 | 1 {
  if (value === undefined || Math.abs(value) < 0.2) return 0;
  return value > 0 ? 1 : -1;
}

function currentGamepadInput(): PlayableEarthInput {
  const gamepad = navigator.getGamepads?.()[0];
  if (!gamepad) return { steer: 0, look: 0 };
  return {
    steer: signedAxis(gamepad.axes[0]),
    look: signedAxis(gamepad.axes[2]),
    forward: signedAxis(-(gamepad.axes[1] ?? 0)),
    strafe: signedAxis(gamepad.axes[0]),
    turn: signedAxis(gamepad.axes[2]),
    run: Boolean(gamepad.buttons[0]?.pressed || gamepad.buttons[6]?.pressed),
  };
}

function combineInput(
  keyboard: PlayableEarthInput,
  gamepad: PlayableEarthInput,
): PlayableEarthInput {
  return {
    steer: keyboard.steer || gamepad.steer,
    look: keyboard.look || gamepad.look,
    forward: keyboard.forward || gamepad.forward || 0,
    strafe: keyboard.strafe || gamepad.strafe || 0,
    turn: keyboard.turn || gamepad.turn || 0,
    run: Boolean(keyboard.run || gamepad.run),
  };
}

export function PlayableEarthStage({
  route,
  exitPath,
  cinematicRender = false,
}: {
  route: QuestRoute;
  exitPath: string;
  cinematicRender?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PlayableEarthViewer | undefined>(undefined);
  const physicsRef = useRef<WorldPhysicsRuntime | undefined>(undefined);
  const playerRef = useRef<WorldPlayerState | undefined>(undefined);
  const controlRef = useRef(initialPlayableEarthState());
  const inputRef = useRef<PlayableEarthInput>({
    steer: 0,
    look: 0,
    ...IDLE_WORLD_INPUT,
  });
  const [status, setStatus] = useState<PlayableEarthStatus>(INITIAL_STATUS);
  const [grounding, setGrounding] =
    useState<PlayableEarthGroundingDebug>(INITIAL_GROUNDING);
  const [control, setControl] = useState(controlRef.current);
  const [physicalReady, setPhysicalReady] = useState(false);
  const [contextState, setContextState] =
    useState<RouteContextHudState>("preview");
  const [mobileControlsExpanded, setMobileControlsExpanded] = useState(false);
  const isMobile = useIsMobile();
  const totalDistanceM = routeDistanceM(route);

  const poseForControl = useCallback(
    (next: PlayableEarthControlState) => {
      const runtime = physicsRef.current;
      const player = playerRef.current;
      return next.mode === "free-roam" && runtime && player
        ? playableEarthWorldPose(route, runtime, player, next)
        : playableEarthPose(route, next);
    },
    [route],
  );

  const commitControl = useCallback(
    (
      update: (current: PlayableEarthControlState) => PlayableEarthControlState,
    ) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      viewerRef.current?.setPose(poseForControl(next));
    },
    [poseForControl],
  );

  const seekTo = useCallback(
    (progressM: number) => {
      commitControl((current) => {
        const next = seekPlayableEarth(current, progressM, totalDistanceM);
        if (current.mode === "free-roam" && physicsRef.current) {
          playerRef.current = worldPlayerAtRouteProgress(
            physicsRef.current,
            next.progressM,
          );
        }
        return next;
      });
    },
    [commitControl, totalDistanceM],
  );

  const toggleFreeRoam = useCallback(() => {
    const runtime = physicsRef.current;
    if (!runtime) return;
    inputRef.current = { steer: 0, look: 0, ...IDLE_WORLD_INPUT };
    commitControl((current) => {
      if (current.mode === "free-roam") {
        const rejoined = rejoinWorldRoute(
          runtime,
          playerRef.current ?? initialWorldPlayer(runtime),
        );
        playerRef.current = rejoined;
        return {
          ...setPlayableEarthMode(current, "guided"),
          playing: false,
          progressM: rejoined.routeProgressM,
          lateralOffsetM: 0,
        };
      }
      playerRef.current = worldPlayerAtRouteProgress(runtime, current.progressM);
      return {
        ...setPlayableEarthMode(current, "free-roam"),
        playing: false,
        lateralOffsetM: 0,
      };
    });
  }, [commitControl]);

  const returnToCheckpoint = useCallback(() => {
    const runtime = physicsRef.current;
    const player = playerRef.current;
    if (!runtime || !player) return;
    const recovered = recoverWorldPlayer(runtime, player);
    playerRef.current = recovered;
    commitControl((current) => ({
      ...current,
      playing: false,
      progressM: recovered.routeProgressM,
    }));
  }, [commitControl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = createPlayableEarthViewer();
    viewerRef.current = viewer;
    const initialControl = initialPlayableEarthState();
    controlRef.current = initialControl;
    setControl(initialControl);
    setStatus(INITIAL_STATUS);
    setGrounding(INITIAL_GROUNDING);
    setPhysicalReady(false);
    physicsRef.current = undefined;
    playerRef.current = undefined;
    void viewer.mount({
      cinematicRender,
      container,
      route,
      onGroundingChange: setGrounding,
      onWorldReady: (runtime) => {
        physicsRef.current = runtime;
        playerRef.current = worldPlayerAtRouteProgress(
          runtime,
          controlRef.current.progressM,
        );
        setPhysicalReady(true);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.state === "ready") {
          if (!cinematicRender) viewer.setPose(poseForControl(controlRef.current));
        }
      },
    });
    return () => {
      viewer.destroy();
      physicsRef.current = undefined;
      playerRef.current = undefined;
      if (viewerRef.current === viewer) viewerRef.current = undefined;
    };
  }, [cinematicRender, poseForControl, route]);

  useEffect(() => {
    if (status.state !== "ready" || cinematicRender) return;
    let frame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    let accumulatorSeconds = 0;
    const tick = (now: number) => {
      accumulatorSeconds += Math.min(0.25, (now - previous) / 1_000);
      previous = now;
      const runtime = physicsRef.current;
      const timestep = 1 / (runtime?.navigation.fixedTimestepHz ?? 60);
      const input = combineInput(inputRef.current, currentGamepadInput());
      let next = controlRef.current;
      while (accumulatorSeconds >= timestep) {
        next = advancePlayableEarth(next, timestep, input, totalDistanceM);
        if (next.mode === "free-roam" && runtime) {
          const player = stepWorldPlayer(
            runtime,
            playerRef.current ?? worldPlayerAtRouteProgress(runtime, next.progressM),
            {
              forward: input.forward ?? 0,
              strafe: input.strafe ?? 0,
              turn: input.turn ?? 0,
              run: input.run ?? false,
            },
          );
          playerRef.current = player;
          next = { ...next, progressM: player.routeProgressM };
        }
        accumulatorSeconds -= timestep;
      }
      controlRef.current = next;
      viewerRef.current?.setPose(poseForControl(next));
      if (now - lastUiUpdate >= 80) {
        setControl(next);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cinematicRender, poseForControl, status.state, totalDistanceM]);

  useEffect(() => {
    setContextState(isMobile ? "compact" : "preview");
    setMobileControlsExpanded(false);
  }, [isMobile, route.slug]);

  useEffect(() => {
    if (control.playing) setContextState("compact");
  }, [control.playing]);

  useEffect(() => {
    const editableTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    const keyDown = (event: KeyboardEvent) => {
      if (editableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const freeRoam = controlRef.current.mode === "free-roam";
      if (key === "a") {
        if (freeRoam) inputRef.current.strafe = -1;
        else inputRef.current.steer = -1;
      }
      if (key === "d") {
        if (freeRoam) inputRef.current.strafe = 1;
        else inputRef.current.steer = 1;
      }
      if (key === "arrowleft") {
        if (freeRoam) inputRef.current.turn = -1;
        else inputRef.current.steer = -1;
      }
      if (key === "arrowright") {
        if (freeRoam) inputRef.current.turn = 1;
        else inputRef.current.steer = 1;
      }
      if (key === "q") {
        if (freeRoam) inputRef.current.turn = -1;
        else inputRef.current.look = -1;
      }
      if (key === "e") {
        if (freeRoam) inputRef.current.turn = 1;
        else inputRef.current.look = 1;
      }
      if (freeRoam && (key === "w" || key === "arrowup")) {
        inputRef.current.forward = 1;
      }
      if (freeRoam && (key === "s" || key === "arrowdown")) {
        inputRef.current.forward = -1;
      }
      if (key === "shift") inputRef.current.run = true;
      if (event.repeat) return;
      if (key === " ") {
        event.preventDefault();
        commitControl(togglePlayableEarthPlayback);
      }
      if (key === "t") {
        if (freeRoam) toggleFreeRoam();
        else {
          commitControl((current) =>
            setPlayableEarthMode(
              current,
              current.mode === "replay" ? "guided" : "replay",
            ),
          );
        }
      }
      if (!freeRoam && (key === "w" || key === "arrowup")) {
        commitControl((current) => cyclePlayableEarthSpeed(current, 1));
      }
      if (!freeRoam && (key === "s" || key === "arrowdown")) {
        commitControl((current) => cyclePlayableEarthSpeed(current, -1));
      }
      if (key === "f" && physicalReady) toggleFreeRoam();
      if (key === "r" && freeRoam) returnToCheckpoint();
      if (key === "c") commitControl(cyclePlayableEarthCameraMode);
      if (key === "g") commitControl(togglePlayableEarthGhost);
      if (key === "+" || key === "=") {
        event.preventDefault();
        commitControl((current) => zoomPlayableEarth(current, "in"));
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        commitControl((current) => zoomPlayableEarth(current, "out"));
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "a" && inputRef.current.strafe === -1) inputRef.current.strafe = 0;
      if (key === "d" && inputRef.current.strafe === 1) inputRef.current.strafe = 0;
      if (key === "arrowleft" && inputRef.current.turn === -1) inputRef.current.turn = 0;
      if (key === "arrowright" && inputRef.current.turn === 1) inputRef.current.turn = 0;
      if ((key === "a" || key === "arrowleft") && inputRef.current.steer === -1) inputRef.current.steer = 0;
      if ((key === "d" || key === "arrowright") && inputRef.current.steer === 1) inputRef.current.steer = 0;
      if (key === "q" && inputRef.current.look === -1) inputRef.current.look = 0;
      if (key === "e" && inputRef.current.look === 1) inputRef.current.look = 0;
      if ((key === "q" || key === "arrowleft") && inputRef.current.turn === -1) inputRef.current.turn = 0;
      if ((key === "e" || key === "arrowright") && inputRef.current.turn === 1) inputRef.current.turn = 0;
      if ((key === "w" || key === "arrowup") && inputRef.current.forward === 1) inputRef.current.forward = 0;
      if ((key === "s" || key === "arrowdown") && inputRef.current.forward === -1) inputRef.current.forward = 0;
      if (key === "shift") inputRef.current.run = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [commitControl, physicalReady, returnToCheckpoint, toggleFreeRoam]);

  const player = playerRef.current;
  const ghostDeltaM = control.progressM - control.ghostProgressM;

  return (
    <section
      aria-label="Playable Earth Lab"
      data-state={status.state}
      data-route-slug={route.slug}
      data-control-mode={control.mode}
      data-lateral-offset={control.lateralOffsetM.toFixed(2)}
      data-camera-yaw={control.cameraYawDeg.toFixed(2)}
      data-camera-range={control.cameraRangeM}
      data-camera-mode={control.cameraMode}
      data-physical-ready={physicalReady}
      data-simulation-tick={player?.tick ?? 0}
      data-player-x={player?.x.toFixed(3) ?? ""}
      data-player-y={player?.y.toFixed(3) ?? ""}
      data-player-z={player?.z.toFixed(3) ?? ""}
      data-checkpoint-node={player?.checkpointNodeId ?? ""}
      data-recovery-count={player?.recoveryCount ?? 0}
      data-blocked-ticks={player?.blockedTickCount ?? 0}
      data-ghost-visible={control.ghostVisible}
      data-ghost-delta={ghostDeltaM.toFixed(2)}
      data-grounding-source={grounding.source}
      data-grounding-reason={grounding.reason}
      data-grounding-offset={grounding.offsetM?.toFixed(2) ?? ""}
      data-cinematic-render={cinematicRender}
      className={
        cinematicRender
          ? "fixed inset-0 z-[100] h-dvh w-dvw overflow-hidden bg-[#02070a]"
          : "relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-[#02070a] md:h-dvh md:min-h-[36rem]"
      }
    >
      <div
        ref={containerRef}
        aria-label="Playable Earth world"
        className="absolute inset-0"
      />

      <div
        className={
          cinematicRender
            ? "hidden"
            : "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start p-3 sm:p-5"
        }
      >
        <RouteContextHud
          route={route}
          label="Playable Earth"
          testId="playable-context"
          detailsTestId="playable-context-details"
          state={contextState}
          backPath={exitPath}
          backLabel="Exit lab"
          icon={<Gamepad2 className="size-4 shrink-0" aria-hidden="true" />}
          onStateChange={setContextState}
          summary={
            new URLSearchParams(window.location.search).get("debugGrounding") === "1" ? (
              <div className="mt-3 text-xs font-semibold uppercase text-primary">
                Grounding: {grounding.source}
                {grounding.offsetM === undefined
                  ? ""
                  : ` · ${grounding.offsetM >= 0 ? "+" : ""}${grounding.offsetM.toFixed(1)} m`}
              </div>
            ) : null
          }
        />
      </div>

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/72 p-6">
          <div
            role={status.state === "unavailable" ? "alert" : "status"}
            aria-live="polite"
            className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-2xl"
          >
            <div className="text-sm font-semibold">{status.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            {status.state === "unavailable" ? (
              <Button asChild className="mt-5">
                <Link to={exitPath}>Return to route</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={
          cinematicRender
            ? "hidden"
            : "pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center sm:inset-x-6 sm:bottom-6"
        }
      >
        <div
          data-testid="playable-controls"
          className="pointer-events-auto w-full max-w-5xl rounded-md border border-border bg-background/92 p-2 shadow-2xl backdrop-blur sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:px-3 sm:py-3"
        >
          {isMobile ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Route className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm text-muted-foreground">
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
                  onClick={() => setMobileControlsExpanded((expanded) => !expanded)}
                >
                  <Settings2 aria-hidden="true" />
                </Button>
              </div>
              <input
                aria-label="Route progress"
                type="range"
                min={0}
                max={totalDistanceM}
                step={1}
                value={control.progressM}
                disabled={status.state !== "ready" || control.mode === "free-roam"}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="h-11 w-full accent-primary"
              />
              {mobileControlsExpanded ? (
                <div
                  data-testid="playable-secondary-controls"
                  className="flex flex-wrap items-center gap-2 border-t border-border pt-2"
                >
                  <ControlIcon
                    label={control.mode === "free-roam" ? "Strafe left" : "Steer left"}
                    className="size-11"
                    disabled={status.state !== "ready" || control.mode === "replay"}
                    onPress={() => {
                      if (control.mode === "free-roam") inputRef.current.strafe = -1;
                      else inputRef.current.steer = -1;
                    }}
                    onRelease={() => {
                      inputRef.current.steer = 0;
                      inputRef.current.strafe = 0;
                    }}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </ControlIcon>
                  <ControlIcon
                    label={control.mode === "free-roam" ? "Strafe right" : "Steer right"}
                    className="size-11"
                    disabled={status.state !== "ready" || control.mode === "replay"}
                    onPress={() => {
                      if (control.mode === "free-roam") inputRef.current.strafe = 1;
                      else inputRef.current.steer = 1;
                    }}
                    onRelease={() => {
                      inputRef.current.steer = 0;
                      inputRef.current.strafe = 0;
                    }}
                  >
                    <ChevronRight aria-hidden="true" />
                  </ControlIcon>
                  <ControlIcon
                    label={control.mode === "free-roam" ? "Turn left" : "Look left"}
                    className="size-11"
                    disabled={status.state !== "ready" || control.mode === "replay"}
                    onPress={() => {
                      if (control.mode === "free-roam") inputRef.current.turn = -1;
                      else inputRef.current.look = -1;
                    }}
                    onRelease={() => {
                      inputRef.current.look = 0;
                      inputRef.current.turn = 0;
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                  </ControlIcon>
                  <ControlIcon
                    label={control.mode === "free-roam" ? "Turn right" : "Look right"}
                    className="size-11"
                    disabled={status.state !== "ready" || control.mode === "replay"}
                    onPress={() => {
                      if (control.mode === "free-roam") inputRef.current.turn = 1;
                      else inputRef.current.look = 1;
                    }}
                    onRelease={() => {
                      inputRef.current.look = 0;
                      inputRef.current.turn = 0;
                    }}
                  >
                    <RotateCw aria-hidden="true" />
                  </ControlIcon>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11"
                    disabled={
                      status.state !== "ready" ||
                      control.cameraMode !== "route-follow" ||
                      control.cameraRangeM === PLAYABLE_EARTH_CAMERA_RANGES_M[0]
                    }
                    aria-label="Zoom in to route"
                    onClick={() =>
                      commitControl((current) => zoomPlayableEarth(current, "in"))
                    }
                  >
                    <ZoomIn aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11"
                    disabled={
                      status.state !== "ready" ||
                      control.cameraMode !== "route-follow" ||
                      control.cameraRangeM === PLAYABLE_EARTH_CAMERA_RANGES_M.at(-1)
                    }
                    aria-label="Zoom out from route"
                    onClick={() =>
                      commitControl((current) => zoomPlayableEarth(current, "out"))
                    }
                  >
                    <ZoomOut aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={status.state !== "ready"}
                    aria-label={`Playback speed ${control.speed}x`}
                    onClick={() =>
                      commitControl((current) => cyclePlayableEarthSpeed(current, 1))
                    }
                  >
                    <Gauge aria-hidden="true" />
                    {control.speed}x
                  </Button>
                  {physicalReady ? (
                    <PhysicalWorldControls
                      className="size-11"
                      control={control}
                      onToggleFreeRoam={toggleFreeRoam}
                      onReturnToCheckpoint={returnToCheckpoint}
                      onCycleCamera={() => commitControl(cyclePlayableEarthCameraMode)}
                      onToggleGhost={() => commitControl(togglePlayableEarthGhost)}
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="icon"
                  className="size-11"
                  disabled={status.state !== "ready" || control.mode === "free-roam"}
                  aria-label={control.playing ? "Pause route" : "Play route"}
                  onClick={() => commitControl(togglePlayableEarthPlayback)}
                >
                  {control.playing ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </Button>
                {physicalReady && control.mode === "free-roam" ? (
                  <div className="flex gap-2">
                    <ControlIcon
                      label="Move forward"
                      className="size-11"
                      disabled={status.state !== "ready"}
                      onPress={() => {
                        inputRef.current.forward = 1;
                      }}
                      onRelease={() => {
                        inputRef.current.forward = 0;
                      }}
                    >
                      <ChevronRight className="-rotate-90" aria-hidden="true" />
                    </ControlIcon>
                    <ControlIcon
                      label="Move backward"
                      className="size-11"
                      disabled={status.state !== "ready"}
                      onPress={() => {
                        inputRef.current.forward = -1;
                      }}
                      onRelease={() => {
                        inputRef.current.forward = 0;
                      }}
                    >
                      <ChevronRight className="rotate-90" aria-hidden="true" />
                    </ControlIcon>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant={control.mode === "guided" ? "default" : "outline"}
                  className="h-11 flex-1"
                  disabled={status.state !== "ready" || control.mode === "free-roam"}
                  aria-label={
                    control.mode === "free-roam"
                      ? "Free roam active"
                      : control.mode === "guided"
                        ? "Resume automatic replay"
                        : "Take control"
                  }
                  onClick={() =>
                    commitControl((current) =>
                      setPlayableEarthMode(
                        current,
                        current.mode === "replay" ? "guided" : "replay",
                      ),
                    )
                  }
                >
                  {control.mode === "free-roam" ? (
                    <Footprints aria-hidden="true" />
                  ) : control.mode === "guided" ? (
                    <Clapperboard aria-hidden="true" />
                  ) : (
                    <Gamepad2 aria-hidden="true" />
                  )}
                  {control.mode === "free-roam"
                    ? "Free roam"
                    : control.mode === "guided"
                      ? "Resume replay"
                      : "Take control"}
                </Button>
              </div>
            </div>
          ) : (
            <>
          <Route className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-28 flex-1">
            <div className="text-xs font-semibold uppercase text-primary">
              {status.state === "ready" ? "Route thread ready" : "Route world loading"}
            </div>
            <div aria-live="off" className="truncate text-sm text-muted-foreground">
              {(control.progressM / 1000).toFixed(2)} / {route.distanceKm.toFixed(1)} km
            </div>
          </div>
          <input
            aria-label="Route progress"
            type="range"
            min={0}
            max={totalDistanceM}
            step={1}
            value={control.progressM}
            disabled={status.state !== "ready" || control.mode === "free-roam"}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="h-8 min-w-36 flex-[2] accent-primary"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={status.state !== "ready" || control.mode === "free-roam"}
            aria-label={control.playing ? "Pause route" : "Play route"}
            title={control.playing ? "Pause route" : "Play route"}
            onClick={() => commitControl(togglePlayableEarthPlayback)}
          >
            {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant={control.mode === "guided" ? "default" : "outline"}
            disabled={status.state !== "ready" || control.mode === "free-roam"}
            aria-label={
              control.mode === "free-roam"
                ? "Free roam active"
                : control.mode === "guided"
                  ? "Resume automatic replay"
                  : "Take control"
            }
            title={
              control.mode === "free-roam"
                ? "Free roam active"
                : control.mode === "guided"
                  ? "Resume automatic replay"
                  : "Take control"
            }
            onClick={() =>
              commitControl((current) =>
                setPlayableEarthMode(
                  current,
                  current.mode === "replay" ? "guided" : "replay",
                ),
              )
            }
          >
            {control.mode === "free-roam" ? (
              <Footprints aria-hidden="true" />
            ) : control.mode === "guided" ? (
              <Clapperboard aria-hidden="true" />
            ) : (
              <Gamepad2 aria-hidden="true" />
            )}
            {control.mode === "free-roam"
              ? "Free roam"
              : control.mode === "guided"
                ? "Resume replay"
                : "Take control"}
          </Button>
          <ControlIcon
            label={control.mode === "free-roam" ? "Strafe left" : "Steer left"}
            disabled={status.state !== "ready" || control.mode === "replay"}
            onPress={() => {
              if (control.mode === "free-roam") inputRef.current.strafe = -1;
              else inputRef.current.steer = -1;
            }}
            onRelease={() => {
              inputRef.current.steer = 0;
              inputRef.current.strafe = 0;
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label={control.mode === "free-roam" ? "Strafe right" : "Steer right"}
            disabled={status.state !== "ready" || control.mode === "replay"}
            onPress={() => {
              if (control.mode === "free-roam") inputRef.current.strafe = 1;
              else inputRef.current.steer = 1;
            }}
            onRelease={() => {
              inputRef.current.steer = 0;
              inputRef.current.strafe = 0;
            }}
          >
            <ChevronRight aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label={control.mode === "free-roam" ? "Turn left" : "Look left"}
            disabled={status.state !== "ready" || control.mode === "replay"}
            onPress={() => {
              if (control.mode === "free-roam") inputRef.current.turn = -1;
              else inputRef.current.look = -1;
            }}
            onRelease={() => {
              inputRef.current.look = 0;
              inputRef.current.turn = 0;
            }}
          >
            <RotateCcw aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label={control.mode === "free-roam" ? "Turn right" : "Look right"}
            disabled={status.state !== "ready" || control.mode === "replay"}
            onPress={() => {
              if (control.mode === "free-roam") inputRef.current.turn = 1;
              else inputRef.current.look = 1;
            }}
            onRelease={() => {
              inputRef.current.look = 0;
              inputRef.current.turn = 0;
            }}
          >
            <RotateCw aria-hidden="true" />
          </ControlIcon>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={
              status.state !== "ready" ||
              control.cameraMode !== "route-follow" ||
              control.cameraRangeM === PLAYABLE_EARTH_CAMERA_RANGES_M[0]
            }
            aria-label="Zoom in to route"
            title="Zoom in to route"
            onClick={() =>
              commitControl((current) => zoomPlayableEarth(current, "in"))
            }
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={
              status.state !== "ready" ||
              control.cameraMode !== "route-follow" ||
              control.cameraRangeM === PLAYABLE_EARTH_CAMERA_RANGES_M.at(-1)
            }
            aria-label="Zoom out from route"
            title="Zoom out from route"
            onClick={() =>
              commitControl((current) => zoomPlayableEarth(current, "out"))
            }
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          {physicalReady ? (
            <PhysicalWorldControls
              control={control}
              onToggleFreeRoam={toggleFreeRoam}
              onReturnToCheckpoint={returnToCheckpoint}
              onCycleCamera={() => commitControl(cyclePlayableEarthCameraMode)}
              onToggleGhost={() => commitControl(togglePlayableEarthGhost)}
            />
          ) : null}
          {physicalReady && control.mode === "free-roam" ? (
            <>
              <ControlIcon
                label="Move forward"
                disabled={status.state !== "ready"}
                onPress={() => {
                  inputRef.current.forward = 1;
                }}
                onRelease={() => {
                  inputRef.current.forward = 0;
                }}
              >
                <ChevronRight className="-rotate-90" aria-hidden="true" />
              </ControlIcon>
              <ControlIcon
                label="Move backward"
                disabled={status.state !== "ready"}
                onPress={() => {
                  inputRef.current.forward = -1;
                }}
                onRelease={() => {
                  inputRef.current.forward = 0;
                }}
              >
                <ChevronRight className="rotate-90" aria-hidden="true" />
              </ControlIcon>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={status.state !== "ready"}
            aria-label={`Playback speed ${control.speed}x`}
            title="Change playback speed"
            onClick={() => commitControl((current) => cyclePlayableEarthSpeed(current, 1))}
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

function PhysicalWorldControls({
  className,
  control,
  onToggleFreeRoam,
  onReturnToCheckpoint,
  onCycleCamera,
  onToggleGhost,
}: {
  className?: string;
  control: PlayableEarthControlState;
  onToggleFreeRoam: () => void;
  onReturnToCheckpoint: () => void;
  onCycleCamera: () => void;
  onToggleGhost: () => void;
}) {
  const freeRoam = control.mode === "free-roam";
  const cameraLabel = control.cameraMode.replace("-", " ");
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant={freeRoam ? "default" : "outline"}
        className={className}
        aria-label={freeRoam ? "Rejoin route" : "Enter free roam"}
        title={freeRoam ? "Rejoin route" : "Enter free roam"}
        onClick={onToggleFreeRoam}
      >
        {freeRoam ? <LocateFixed aria-hidden="true" /> : <Footprints aria-hidden="true" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={className}
        disabled={!freeRoam}
        aria-label="Return to checkpoint"
        title="Return to checkpoint"
        onClick={onReturnToCheckpoint}
      >
        <Flag aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={className}
        aria-label={`Camera mode ${cameraLabel}`}
        title={`Camera mode: ${cameraLabel}`}
        onClick={onCycleCamera}
      >
        <Camera aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={control.ghostVisible ? "default" : "outline"}
        className={className}
        aria-label={control.ghostVisible ? "Hide route ghost" : "Show route ghost"}
        aria-pressed={control.ghostVisible}
        title={control.ghostVisible ? "Hide route ghost" : "Show route ghost"}
        onClick={onToggleGhost}
      >
        <ScanLine aria-hidden="true" />
      </Button>
    </>
  );
}

function ControlIcon({
  label,
  className,
  disabled,
  onPress,
  onRelease,
  children,
}: {
  label: string;
  className?: string;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={className}
      disabled={disabled}
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onLostPointerCapture={onRelease}
    >
      {children}
    </Button>
  );
}
