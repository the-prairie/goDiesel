import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FlaskConical,
  Gamepad2,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Route,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { QuestRoute } from "@/domain/routes";
import { routeDetailPath } from "@/navigation";
import {
  advancePlayableEarth,
  cyclePlayableEarthSpeed,
  initialPlayableEarthState,
  playableEarthPose,
  routeDistanceM,
  seekPlayableEarth,
  setPlayableEarthMode,
  togglePlayableEarthPlayback,
  type PlayableEarthControlState,
  type PlayableEarthInput,
} from "@/replay/playable-earth-controller";
import {
  createPlayableEarthViewer,
  type PlayableEarthStatus,
  type PlayableEarthViewer,
} from "@/replay/playable-earth-viewer";

const INITIAL_STATUS: PlayableEarthStatus = {
  state: "loading",
  title: "Building your route world",
  message: "Preparing the experimental Earth viewer.",
};

export function PlayableEarthStage({ route }: { route: QuestRoute }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PlayableEarthViewer | undefined>(undefined);
  const controlRef = useRef(initialPlayableEarthState());
  const inputRef = useRef<PlayableEarthInput>({ steer: 0, look: 0 });
  const [status, setStatus] = useState<PlayableEarthStatus>(INITIAL_STATUS);
  const [control, setControl] = useState(controlRef.current);
  const totalDistanceM = routeDistanceM(route);

  const commitControl = useCallback(
    (
      update: (current: PlayableEarthControlState) => PlayableEarthControlState,
    ) => {
      const next = update(controlRef.current);
      controlRef.current = next;
      setControl(next);
      viewerRef.current?.setPose(playableEarthPose(route, next));
    },
    [route],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = createPlayableEarthViewer();
    viewerRef.current = viewer;
    const initialControl = initialPlayableEarthState();
    controlRef.current = initialControl;
    setControl(initialControl);
    setStatus(INITIAL_STATUS);
    void viewer.mount({
      container,
      route,
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus.state === "ready") {
          viewer.setPose(playableEarthPose(route, controlRef.current));
        }
      },
    });
    return () => {
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = undefined;
    };
  }, [route]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let frame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const next = advancePlayableEarth(
        controlRef.current,
        (now - previous) / 1000,
        inputRef.current,
        totalDistanceM,
      );
      previous = now;
      controlRef.current = next;
      viewerRef.current?.setPose(playableEarthPose(route, next));
      if (now - lastUiUpdate >= 80) {
        setControl(next);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [route, status.state, totalDistanceM]);

  useEffect(() => {
    const editableTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    const keyDown = (event: KeyboardEvent) => {
      if (editableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "a" || key === "arrowleft") inputRef.current.steer = -1;
      if (key === "d" || key === "arrowright") inputRef.current.steer = 1;
      if (key === "q") inputRef.current.look = -1;
      if (key === "e") inputRef.current.look = 1;
      if (event.repeat) return;
      if (key === " ") {
        event.preventDefault();
        commitControl(togglePlayableEarthPlayback);
      }
      if (key === "t") {
        commitControl((current) =>
          setPlayableEarthMode(
            current,
            current.mode === "replay" ? "guided" : "replay",
          ),
        );
      }
      if (key === "w" || key === "arrowup") {
        commitControl((current) => cyclePlayableEarthSpeed(current, 1));
      }
      if (key === "s" || key === "arrowdown") {
        commitControl((current) => cyclePlayableEarthSpeed(current, -1));
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        (key === "a" || key === "arrowleft") &&
        inputRef.current.steer === -1
      ) {
        inputRef.current.steer = 0;
      }
      if (
        (key === "d" || key === "arrowright") &&
        inputRef.current.steer === 1
      ) {
        inputRef.current.steer = 0;
      }
      if (key === "q" && inputRef.current.look === -1) inputRef.current.look = 0;
      if (key === "e" && inputRef.current.look === 1) inputRef.current.look = 0;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [commitControl]);

  return (
    <section
      aria-label="Playable Earth Lab"
      data-state={status.state}
      data-route-slug={route.slug}
      data-control-mode={control.mode}
      data-lateral-offset={control.lateralOffsetM.toFixed(2)}
      data-camera-yaw={control.cameraYawDeg.toFixed(2)}
      className="relative min-h-[calc(100dvh-3.5rem)] overflow-hidden bg-[#02070a]"
    >
      <div
        ref={containerRef}
        aria-label="Playable Earth world"
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-md rounded-md border border-border bg-background/90 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <FlaskConical className="size-4" aria-hidden="true" />
            Playable Earth Lab
          </div>
          <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{route.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up
          </p>
        </div>
        <Button asChild variant="secondary" className="pointer-events-auto shrink-0">
          <Link to={routeDetailPath(route.slug)}>
            <ArrowLeft aria-hidden="true" />
            Exit lab
          </Link>
        </Button>
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
                <Link to={routeDetailPath(route.slug)}>Return to route</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center sm:inset-x-6 sm:bottom-6">
        <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-2 rounded-md border border-border bg-background/92 px-3 py-3 shadow-2xl backdrop-blur">
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
            disabled={status.state !== "ready"}
            onChange={(event) =>
              commitControl((current) =>
                seekPlayableEarth(current, Number(event.target.value), totalDistanceM),
              )
            }
            className="h-8 min-w-36 flex-[2] accent-primary"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            disabled={status.state !== "ready"}
            aria-label={control.playing ? "Pause route" : "Play route"}
            title={control.playing ? "Pause route" : "Play route"}
            onClick={() => commitControl(togglePlayableEarthPlayback)}
          >
            {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant={control.mode === "guided" ? "default" : "outline"}
            disabled={status.state !== "ready"}
            aria-label={control.mode === "guided" ? "Resume automatic replay" : "Take control"}
            title={control.mode === "guided" ? "Resume automatic replay" : "Take control"}
            onClick={() =>
              commitControl((current) =>
                setPlayableEarthMode(
                  current,
                  current.mode === "replay" ? "guided" : "replay",
                ),
              )
            }
          >
            {control.mode === "guided" ? (
              <Clapperboard aria-hidden="true" />
            ) : (
              <Gamepad2 aria-hidden="true" />
            )}
            {control.mode === "guided" ? "Resume replay" : "Take control"}
          </Button>
          <ControlIcon
            label="Steer left"
            disabled={status.state !== "ready" || control.mode !== "guided"}
            onPress={() => {
              inputRef.current.steer = -1;
            }}
            onRelease={() => {
              inputRef.current.steer = 0;
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label="Steer right"
            disabled={status.state !== "ready" || control.mode !== "guided"}
            onPress={() => {
              inputRef.current.steer = 1;
            }}
            onRelease={() => {
              inputRef.current.steer = 0;
            }}
          >
            <ChevronRight aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label="Look left"
            disabled={status.state !== "ready" || control.mode !== "guided"}
            onPress={() => {
              inputRef.current.look = -1;
            }}
            onRelease={() => {
              inputRef.current.look = 0;
            }}
          >
            <RotateCcw aria-hidden="true" />
          </ControlIcon>
          <ControlIcon
            label="Look right"
            disabled={status.state !== "ready" || control.mode !== "guided"}
            onPress={() => {
              inputRef.current.look = 1;
            }}
            onRelease={() => {
              inputRef.current.look = 0;
            }}
          >
            <RotateCw aria-hidden="true" />
          </ControlIcon>
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
        </div>
      </div>
    </section>
  );
}

function ControlIcon({
  label,
  disabled,
  onPress,
  onRelease,
  children,
}: {
  label: string;
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
