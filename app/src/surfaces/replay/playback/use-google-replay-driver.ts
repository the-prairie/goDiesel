import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { QuestRoute } from "@/domain/route";
import { routeDistanceM } from "@/domain/geometry/route-path";
import {
  googleRouteCameraPose,
  googleRouteThreadTreatment,
  type GoogleRouteCameraPose,
  type GoogleRouteNavigatorState,
} from "@/surfaces/replay/playback/route-navigator-controller";
import type { ReplaySessionEvent } from "@/surfaces/replay/playback/replay-session-state";
import {
  initialGoogleReplayStageState,
  reduceGoogleReplayStage,
  type GoogleReplayStageEvent,
} from "@/surfaces/replay/playback/google-replay-stage-state";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";
import { sustainedRouteCamera } from "@/surfaces/replay/scene/route-camera-score";
import {
  advanceRouteCameraMotion,
  createRouteCameraMotionState,
  routeCameraMotionHasSettled,
  type RouteCameraMotionState,
} from "@/surfaces/replay/scene/route-camera-stabilizer";
import { useReducedMotion } from "@/ui/use-reduced-motion";

/**
 * The camera smoothing the frame driver advances imperatively. Settling is
 * derived from `motion`; every reset goes through `idleStageCamera`.
 */
interface StageCamera {
  motion: RouteCameraMotionState | undefined;
  target: GoogleRouteCameraPose | undefined;
  lastAt: number | undefined;
}

function idleStageCamera(): StageCamera {
  return { motion: undefined, target: undefined, lastAt: undefined };
}

function stageCameraSettling(camera: StageCamera) {
  return camera.motion !== undefined && !routeCameraMotionHasSettled(camera.motion);
}

export interface GoogleReplayDriverOptions {
  route: QuestRoute;
  /**
   * `sustained` holds production Replay's composed camera; `base` uses the
   * plain route camera the lab shows.
   */
  camera: "sustained" | "base";
  palette: "immersive" | "neutral";
  /** Dresses the position marker in place of the default dot or photo. */
  positionMarker?: (marker: HTMLElement) => () => void;
}

/**
 * Mounts the native Google 3D engine for one route and drives it: the
 * session reducer, the camera smoothing, and the frame driver that advances
 * playback while the scene is ready. The reducer state lives in a ref that
 * `dispatchStage` alone writes; React receives throttled snapshots.
 */
export function useGoogleReplayDriver({ route, camera, palette, positionMarker }: GoogleReplayDriverOptions) {
  const stageRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const positionMarkerRef = useRef(positionMarker);
  positionMarkerRef.current = positionMarker;
  const viewportWidthRef = useRef(window.innerWidth);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const cameraRef = useRef<StageCamera>(idleStageCamera());
  const sessionRef = useRef(initialGoogleReplayStageState());
  const [session, setSession] = useState(sessionRef.current);
  const status = session.status;
  const totalDistanceM = routeDistanceM(route);

  const desiredCamera = useCallback((state: GoogleRouteNavigatorState) => {
    const base = googleRouteCameraPose(route, state);
    return camera === "sustained"
      ? sustainedRouteCamera(route, state, base, viewportWidthRef.current)
      : base;
  }, [camera, route]);

  const renderCamera = useCallback(
    (
      desired: GoogleRouteCameraPose,
      now = performance.now(),
      force = false,
      movement: "transition" | "tracking" = "transition",
    ) => {
      const { motion: previous, lastAt: previousAt } = cameraRef.current;
      const elapsedSeconds =
        previousAt === undefined
          ? 1 / 30
          : Math.min(0.1, (now - previousAt) / 1_000);
      const motion =
        force || !previous
          ? createRouteCameraMotionState(desired)
          : advanceRouteCameraMotion(previous, desired, elapsedSeconds, 0.48, movement);
      cameraRef.current = { motion, target: desired, lastAt: now };
      engineRef.current?.setCamera(motion.pose);
    },
    [],
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.getBoundingClientRect().width;
      if (!width) return;
      viewportWidthRef.current = width;
      if (engineRef.current && sessionRef.current.control.following) {
        renderCamera(desiredCamera(sessionRef.current.control));
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [desiredCamera, renderCamera]);

  const dispatchStage = useCallback(
    (event: GoogleReplayStageEvent, publish = true) => {
      const next = reduceGoogleReplayStage(sessionRef.current, event);
      sessionRef.current = next;
      if (publish) setSession(next);
      return next;
    },
    [],
  );

  const publishStage = useCallback(() => setSession(sessionRef.current), []);

  const commitControl = useCallback(
    (event: ReplaySessionEvent) => {
      const previous = sessionRef.current.control;
      const next = dispatchStage({ type: "controlRequested", event }).control;
      engineRef.current?.setFollowing(next.following);
      engineRef.current?.setGrounding(next.groundingMode);
      if (next.following && !previous.following) {
        const actual = engineRef.current?.readCamera();
        if (actual) {
          cameraRef.current = {
            ...cameraRef.current,
            motion: createRouteCameraMotionState({ ...actual, progressM: next.progressM }),
            lastAt: performance.now(),
          };
        }
      }
      if (next.following) {
        const reposition = event.type === "progressSelected" || event.type === "cameraSelected" ||
          event.type === "zoomRequested" || event.type === "followingChanged";
        renderCamera(desiredCamera(next), performance.now(), reducedMotionRef.current && reposition);
      }
      engineRef.current?.setCinematicRoute(
        googleRouteThreadTreatment(route, next),
      );
    },
    [desiredCamera, dispatchStage, renderCamera, route],
  );

  const releaseCamera = useCallback(() => {
    if (sessionRef.current.control.following) commitControl({ type: "followingChanged", following: false });
  }, [commitControl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createGoogleRouteNavigatorEngine();
    engineRef.current = engine;
    cameraRef.current = idleStageCamera();
    const { sessionId, control: initial } = dispatchStage({ type: "sessionStarted" });

    void engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: initial.groundingMode,
      headingSmoothing: 1,
      initialCamera: desiredCamera(initial),
      routeStyle: {
        color: "#f5f5f5",
        mode: "filament",
        palette,
        outerColor: "#111111",
        outerWidth: 0.14,
        width: 3,
      },
      positionMarker: positionMarkerRef.current,
      onStatus: (next, reason) => {
        if (engineRef.current !== engine) return;
        dispatchStage({ type: "statusReceived", sessionId, status: next, reason });
        if (next.state === "ready") {
          const readyTarget = desiredCamera(sessionRef.current.control);
          renderCamera(readyTarget, performance.now(), true);
          engine.setCinematicRoute(
            googleRouteThreadTreatment(route, sessionRef.current.control),
          );
        }
      },
    });

    return () => {
      engine.destroy();
      cameraRef.current = idleStageCamera();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [desiredCamera, dispatchStage, palette, renderCamera, route]);

  useEffect(() => {
    if (reducedMotion && status.state === "ready" && sessionRef.current.control.following) {
      renderCamera(desiredCamera(sessionRef.current.control), performance.now(), true);
    }
  }, [desiredCamera, reducedMotion, renderCamera, status.state]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastRouteUpdate = previous;
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const current = sessionRef.current.control;
      const elapsedSeconds = (now - previous) / 1_000;
      const next = dispatchStage({
        type: "controlRequested",
        event: { type: "frameElapsed", elapsedSeconds, totalDistanceM },
      }, false).control;
      previous = now;
      const progressChanged = next.progressM !== current.progressM;
      const playbackChanged = next.playing !== current.playing;
      const cameraSettling = stageCameraSettling(cameraRef.current);
      if (next.following && (progressChanged || cameraSettling)) {
        const desired = progressChanged ? desiredCamera(next) : cameraRef.current.target;
        if (desired) renderCamera(desired, now, false, progressChanged ? "tracking" : "transition");
      }
      if (progressChanged && (playbackChanged || now - lastRouteUpdate >= 40)) {
        engineRef.current?.setCinematicRoute(
          googleRouteThreadTreatment(route, next),
        );
        lastRouteUpdate = now;
      }
      if (playbackChanged || (progressChanged && now - lastUiUpdate >= 90)) {
        publishStage();
        lastUiUpdate = now;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [desiredCamera, dispatchStage, publishStage, renderCamera, route, status.state, totalDistanceM]);

  return { stageRef, containerRef, session, sessionRef, dispatchStage, commitControl, releaseCamera, totalDistanceM };
}
