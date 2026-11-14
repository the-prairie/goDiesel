import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useRouteDetail } from "@/data/use-route-detail";
import { context2d } from "@/labs/overland/engine/canvas";
import { coverMap, drawCover } from "@/labs/overland/engine/cover";
import { wrapForBox } from "@/labs/overland/engine/screens";
import type { RouteMapInput } from "@/labs/overland/engine/route-map";
import { CROSSFADE_MS, DIVE_MS, WIPE_STEP_MS, coverPixelScale, nativeRect } from "@/labs/overland/model/dither-wipe";
import { diveStart } from "@/labs/overland/model/dive";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import { attributionCorners, realmLayout, type Insets, type Rect, type RealmViewport } from "@/labs/overland/model/realm-layout";
import {
  initialOverlandJumpState,
  jumpPresentation,
  reduceOverlandJump,
  surfaceCovered,
  townCover,
  type JumpTransition,
  type TownCover,
  type OverlandJumpEvent,
} from "@/labs/overland/overland-jump-state";
import { Key, PixelLabel } from "@/labs/overland/overland-ui";
import type { GoogleRendererUnavailableReason, GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";
import { useReducedMotion } from "@/ui/use-reduced-motion";

// The engine, the camera and the realm's controls load only when a route
// is entered; browsing never mounts the 3D map.
const OverlandRealm = lazy(() => import("@/labs/overland/overland-realm"));

const DIVE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SURFACE_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";

function readSafeArea(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:var(--safe-area-top,0px) var(--safe-area-right,0px) var(--safe-area-bottom,0px) var(--safe-area-left,0px)";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

export function useRealmViewport(): RealmViewport {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight, safe: readSafeArea() });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const update = () => setViewport(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return viewport;
}

/** The box's padding, gap and its one key, in CSS pixels. */
const STATUS_KEY_ROOM = 18 + 8 + 6 + 96;

function StatusBox({ viewport, testId, message, children }: { viewport: RealmViewport; testId: string; message: string; children: React.ReactNode }) {
  const { controls } = realmLayout(viewport, 0);
  return (
    <div
      className="overland-jump-status"
      data-testid={testId}
      role="status"
      style={{ left: controls.left, top: controls.top, width: controls.width, minHeight: controls.height }}
    >
      <p className="overland-jump-status-text">
        <span className="sr-only">{message}</span>
        {wrapForBox(message, Math.floor((controls.width - STATUS_KEY_ROOM) / 2)).map((line) => (
          <PixelLabel key={line} scale={2} text={line} />
        ))}
      </p>
      {children}
    </div>
  );
}

/** What a 3D town does for a jump that starts in it. */
export interface TownJumpCover {
  /** The town camera dives to the signpost; resolves when it is there. */
  dive(): Promise<void>;
  /** Ends a dive or a way back where it was going. */
  finish(): void;
  /** The hold: she runs on out of town while her line draws ahead. */
  travel(): void;
  /** The camera returns to the town's view; resolves when it is there. */
  surface(): Promise<void>;
}

export interface OverlandJumpProps {
  entry: OverlandEntry;
  map: RouteMapInput;
  transition: JumpTransition;
  /** `dive` when jumped into from the entry; `direct` for a deep link. */
  entrance: "dive" | "direct";
  /** The entry's little route map on screen, which the dive grows out of. */
  miniMapRect: () => Rect | undefined;
  onExit: () => void;
  /** Set when the jump starts in a 3D town: the town is the cover. */
  cover?: TownJumpCover;
  /** Where the jump is drawn; the page's body by default. */
  container?: HTMLElement | null;
  /** How the town should cover the live map, at every phase. */
  onCover?: (cover: TownCover) => void;
}

/**
 * The jump from a route's entry into its 3D world and back. The reducer
 * owns the phases; this component owns the timers, the dive, and the cover
 * drawn over the live map, and dispatches only phase changes.
 */
export function OverlandJump({ entry, map, transition, entrance, miniMapRect, onExit, cover, container, onCover }: OverlandJumpProps) {
  const town = cover !== undefined;
  const reducedMotion = useReducedMotion();
  const viewport = useRealmViewport();
  const [state, dispatch] = useReducer(reduceOverlandJump, undefined, initialOverlandJumpState);
  const detail = useRouteDetail(entry.slug);
  const rootRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<Animation | undefined>(undefined);
  const presentation = jumpPresentation(state);
  const jumpId = "jumpId" in state ? state.jumpId : 0;
  const phase = state.phase;

  // The jump starts as the component mounts; a deep link has no dive.
  useEffect(() => {
    dispatch({ type: "jumpRequested", slug: entry.slug, reducedMotion, transition });
    if (entrance === "direct") dispatch({ type: "diveFinished", jumpId: 1 });
    // The first render decides the jump; later changes do not restart it.
  }, []);

  // A route detail that cannot load is a scene that cannot open.
  useEffect(() => {
    if (!jumpId || detail.status === "idle" || detail.status === "loading" || detail.status === "ready") return;
    dispatch({ type: "sceneStatusReceived", jumpId, status: { state: "unavailable", message: "The route could not be loaded." } });
  }, [detail.status, jumpId]);

  // ---------------------------------------------------------------- cover

  const k = coverPixelScale(viewport.width);
  const coverWidth = Math.ceil(viewport.width / k);
  const coverHeight = Math.ceil(viewport.height / k);
  const cell = Math.max(2, Math.round(16 / k));
  const routeCover = useMemo(() => coverMap(map, coverWidth, coverHeight), [map, coverWidth, coverHeight]);
  const corners = useMemo(() => attributionCorners(viewport).map((corner) => nativeRect(corner, k)), [k, viewport]);
  const crossfade = state.phase !== "browsing" && state.reducedMotion;
  // With reduced motion the cover is never dithered: it fades as a whole.
  const drawnCoverage = crossfade ? 1 : presentation.coverCoverage;
  const coverOpacity = crossfade && presentation.coverCoverage === 0 ? 0 : 1;
  const [fadedOut, setFadedOut] = useState(false);
  useEffect(() => setFadedOut(false), [coverOpacity]);
  const coverHidden = (phase === "realm" || (phase === "surfacing" && !surfaceCovered(state))) && (crossfade ? fadedOut : drawnCoverage === 0);
  const animating = !town && !reducedMotion && (phase === "diving" || phase === "holding" || phase === "fallback");
  const clockRef = useRef(0);
  const drawnRef = useRef("");

  const paint = useCallback(
    (now: number) => {
      const canvas = coverRef.current;
      if (!canvas) return;
      const clear = presentation.liveMap ? corners : [];
      const key = `${coverWidth}x${coverHeight}|${drawnCoverage}|${clear.length}|${Math.floor(now / 120)}`;
      if (drawnRef.current === key) return;
      drawnRef.current = key;
      drawCover(context2d(canvas), { map: routeCover, kind: entry.kind, coverage: drawnCoverage, cell, clear, now });
    },
    [cell, corners, coverHeight, coverWidth, drawnCoverage, entry.kind, presentation.liveMap, routeCover],
  );

  // Painted in the same commit as the phase, so the live map never shows
  // without the cover over it.
  useLayoutEffect(() => paint(clockRef.current), [paint]);
  useEffect(() => {
    if (!animating) return;
    let frame = 0;
    const tick = (now: number) => {
      clockRef.current = now;
      paint(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, paint]);

  // ---------------------------------------------------------------- dive

  const coverBox = useMemo(() => ({ width: coverWidth * k, height: coverHeight * k }), [coverHeight, coverWidth, k]);
  const diveKeyframes = useCallback(() => {
    const mini = miniMapRect();
    if (!mini) return undefined;
    const start = diveStart(mini, coverBox);
    const { clip } = start;
    return {
      small: {
        transform: `translate(${start.translateX}px, ${start.translateY}px) scale(${start.scale})`,
        clipPath: `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px round ${4 / start.scale}px)`,
      },
      full: { transform: "translate(0px, 0px) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" },
    };
  }, [coverBox, miniMapRect]);

  // From a town, the town's camera dives; a skip ends it where it was going.
  const townDiveRef = useRef(0);
  useEffect(() => {
    if (!cover) return;
    if (phase === "diving" && townDiveRef.current !== jumpId) {
      townDiveRef.current = jumpId;
      void cover.dive().then(() => dispatch({ type: "diveFinished", jumpId }));
    } else if (phase !== "diving" && phase !== "surfacing") cover.finish();
  }, [cover, jumpId, phase]);
  const townTravelRef = useRef(0);
  useEffect(() => {
    if (!cover || phase !== "holding" || townTravelRef.current === jumpId) return;
    townTravelRef.current = jumpId;
    cover.travel();
  }, [cover, jumpId, phase]);
  useLayoutEffect(() => {
    if (onCover && transition === "town") onCover(townCover(state));
  }, [onCover, state, transition]);

  useLayoutEffect(() => {
    if (town) return;
    if (phase !== "diving") {
      // A skip ends the dive where it was going.
      if (animationRef.current?.playState === "running" && phase !== "surfacing") animationRef.current.finish();
      return;
    }
    const canvas = coverRef.current;
    const frames = diveKeyframes();
    if (!canvas || !frames || animationRef.current) {
      if (!frames) dispatch({ type: "diveFinished", jumpId });
      return;
    }
    const animation = canvas.animate(
      [
        { ...frames.small, opacity: 0, offset: 0 },
        { ...frames.small, opacity: 1, offset: 0.08 },
        { ...frames.full, opacity: 1, offset: 1 },
      ],
      { duration: DIVE_MS, easing: DIVE_EASING, fill: "forwards" },
    );
    animationRef.current = animation;
    animation.onfinish = () => dispatch({ type: "diveFinished", jumpId });
  }, [diveKeyframes, jumpId, phase]);

  // The wipe, and the way back out, step on a timer the reducer counts.
  const stepping = phase === "resolving" || (phase === "surfacing" && !surfaceCovered(state));
  useEffect(() => {
    if (!stepping) return;
    const timer = window.setTimeout(() => dispatch({ type: "resolveStepElapsed", jumpId }), WIPE_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [jumpId, state, stepping]);

  // Once covered again, the dive plays in reverse, or the scene crossfades.
  const covered = surfaceCovered(state);
  useLayoutEffect(() => {
    if (!covered) return;
    if (cover) {
      // The town is whole again over the map; its camera pulls back out.
      if (state.phase === "surfacing" && state.reducedMotion) {
        const timer = window.setTimeout(() => dispatch({ type: "surfaceFinished", jumpId }), CROSSFADE_MS);
        void cover.surface();
        return () => window.clearTimeout(timer);
      }
      void cover.surface().then(() => dispatch({ type: "surfaceFinished", jumpId }));
      return;
    }
    let animation: Animation | undefined;
    if (state.phase === "surfacing" && state.reducedMotion) {
      animation = rootRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: "linear", fill: "forwards" });
    } else {
      const frames = diveKeyframes();
      animationRef.current?.cancel();
      animation = frames
        ? coverRef.current?.animate(
            [
              { ...frames.full, opacity: 1, offset: 0 },
              { ...frames.small, opacity: 1, offset: 0.88 },
              { ...frames.small, opacity: 0, offset: 1 },
            ],
            { duration: DIVE_MS, easing: SURFACE_EASING, fill: "forwards" },
          )
        : undefined;
    }
    if (!animation) {
      dispatch({ type: "surfaceFinished", jumpId });
      return;
    }
    animationRef.current = animation;
    animation.onfinish = () => dispatch({ type: "surfaceFinished", jumpId });
    // Runs once, when the way out is covered; the rest is read as it was then.
  }, [covered]);

  // Back at browsing: the page returns to the entry. A cancel that never
  // reversed the dive fades away first.
  const exitedRef = useRef(false);
  const previousPhase = useRef(phase);
  useEffect(() => {
    const from = previousPhase.current;
    previousPhase.current = phase;
    if (phase !== "browsing" || state.lastJumpId === 0 || exitedRef.current) return;
    exitedRef.current = true;
    if (from === "surfacing") {
      onExit();
      return;
    }
    if (cover) {
      // A cancel from a town: the camera returns, and the town is the page.
      void cover.surface().then(onExit);
      return;
    }
    const fade = rootRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: "linear", fill: "forwards" });
    if (fade) fade.onfinish = onExit;
    else onExit();
  }, [onExit, phase, state]);

  // ---------------------------------------------------------------- input

  const send = useCallback((event: OverlandJumpEvent) => dispatch(event), []);
  useEffect(() => {
    const transitional = phase === "diving" || phase === "resolving" || phase === "surfacing";
    const onKey = (event: KeyboardEvent) => {
      // An open photo takes its own keys; Escape closes it, not the jump.
      if (document.querySelector("[data-overland-viewer]")) return;
      if (event.key === "Escape") {
        if (phase === "diving" || phase === "holding") send({ type: "cancelRequested" });
        else if (phase === "surfacing") send({ type: "skipRequested" });
        else send({ type: "leaveRequested" });
      } else if (transitional) {
        send({ type: "skipRequested" });
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointer = () => {
      if (transitional) send({ type: "skipRequested" });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [phase, send]);

  const onStatus = useCallback(
    (id: number, status: GoogleRouteNavigatorStatus, reason?: GoogleRendererUnavailableReason) =>
      dispatch({ type: "sceneStatusReceived", jumpId: id, status, reason }),
    [],
  );
  const leave = useCallback(() => dispatch({ type: "leaveRequested" }), []);
  const focusOnMount = useCallback((button: HTMLButtonElement | null) => button?.focus({ preventScroll: true }), []);

  const engineWanted =
    jumpId > 0 && phase !== "browsing" && phase !== "fallback" && !(covered && !state.reducedMotion) && detail.status === "ready";
  const fallbackMessage =
    state.phase === "fallback" && state.reason === "authentication"
      ? "Google 3D is unavailable."
      : "The 3D view isn't available right now.";
  const fadeIn = reducedMotion || entrance === "direct";

  return createPortal(
    <>
    <div
      className={`overland-jump${town ? " overland-jump-town" : fadeIn ? " overland-jump-fade-in" : ""}${presentation.liveMap ? " overland-jump-live" : ""}`}
      data-entrance={entrance}
      data-jump-phase={phase}
      data-pixel-level={presentation.pixelLevel}
      data-testid="overland-jump"
      data-transition={transition}
      ref={rootRef}
    >
      {engineWanted && detail.status === "ready" ? (
        <Suspense fallback={null}>
          <OverlandRealm
            entry={entry}
            jumpId={jumpId}
            onLeave={leave}
            onStatus={onStatus}
            phase={phase}
            presentation={presentation}
            reducedMotion={reducedMotion}
            route={detail.route}
            viewport={viewport}
          />
        </Suspense>
      ) : null}
      {town ? null : (
      <canvas
        aria-hidden="true"
        className="overland-jump-cover"
        data-corner-height={corners[0]?.height}
        data-cover-coverage={drawnCoverage}
        data-live-map={presentation.liveMap}
        data-testid="overland-jump-cover"
        height={coverHeight}
        hidden={coverHidden}
        onTransitionEnd={() => setFadedOut(coverOpacity === 0)}
        ref={coverRef}
        style={{
          width: coverBox.width,
          height: coverBox.height,
          opacity: coverOpacity,
          transition: crossfade ? `opacity ${CROSSFADE_MS}ms linear` : undefined,
        }}
        width={coverWidth}
      />
      )}
    </div>
    <div className={`overland-jump-status-layer${town ? " overland-jump-town-status" : ""}`}>
      {phase === "holding" && town ? (
        <div className="overland-jump-travel" data-testid="overland-jump-travel" role="status" style={{ right: 12 + viewport.safe.right, bottom: 48 + viewport.safe.bottom }}>
          <span className="sr-only">Loading the 3D view.</span>
          <Key className="overland-jump-status-key" label="Cancel" onClick={() => dispatch({ type: "cancelRequested" })}>
            <PixelLabel scale={2} text="Cancel" />
          </Key>
        </div>
      ) : null}
      {phase === "holding" && !town ? (
        <StatusBox message="Loading the 3D view." testId="overland-jump-status" viewport={viewport}>
          <Key className="overland-jump-status-key" label="Cancel" onClick={() => dispatch({ type: "cancelRequested" })} ref={focusOnMount}>
            <PixelLabel scale={2} text="Cancel" />
          </Key>
        </StatusBox>
      ) : null}
      {state.phase === "fallback" ? (
        <StatusBox message={fallbackMessage} testId="overland-jump-fallback" viewport={viewport}>
          <Key className="overland-jump-status-key" label="Back" onClick={leave} ref={focusOnMount}>
            <PixelLabel scale={2} text="Back" />
          </Key>
        </StatusBox>
      ) : null}
    </div>
    </>,
    container ?? document.body,
  );
}
