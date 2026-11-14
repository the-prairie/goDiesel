import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { QuestRoute } from "@/domain/route";
import { scrubKeyTarget } from "@/labs/sketch/sketch-replay-controls";
import { clockAt, effortColour, findStops, gradesOf, progressAtX, ridgeWindow, sampleRidge, scrubBy, tickStep, verticalRange } from "@/labs/sketch/sketch-ridge";
import { HOLD_MS, initialRidgeGesture, reduceRidgeGesture, type RidgeEffect, type RidgeGestureEvent } from "@/labs/sketch/sketch-ridge-gesture";

const INK = "#1d1d1f";
const PAPER = "#f4f2ec";
const SAMPLES = 140;
/** Where the ridge is drawn inside its strip: the readout above it, the ticks below. */
const TOP = 60;
const BASE_GAP = 28;
const MARKER = 20;
const TAP_RADIUS = 30;
const EDGE_CLEAR = 32;

const km = (m: number) => (m / 1000).toFixed(1);

/** Counters for measuring the ridge's drawing (read by the performance harness). */
const stats = { draws: 0, ms: 0 };
(globalThis as { __ridge?: typeof stats }).__ridge = stats;

export interface SketchRidgeProps {
  route: QuestRoute;
  progressM: number;
  totalM: number;
  playing: boolean;
  reducedMotion: boolean;
  width: number;
  height: number;
  safeBottom: number;
  onSeek: (progressM: number) => void;
  onToggle: () => void;
  /** The play/pause button, for the replay to focus when it opens. */
  playRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The replay's playback control in the sketch skin: the route's profile as a
 * ridge along the bottom. Behind her it is coloured by effort, ahead it is
 * paper and hatched ink; the marker rides it and plays or pauses; dragging
 * anywhere scrubs; holding opens the 6 km round her. One slider and one
 * play/pause button for assistive tech and the keyboard.
 */
export function SketchRidge({ route, progressM, totalM, playing, reducedMotion, width, height, safeBottom, onSeek, onToggle, playRef }: SketchRidgeProps) {
  const points = route.route;
  const temporal = route.provenance?.temporal;
  const stops = useMemo(() => findStops(points.map((p) => ({ d: p.d, elev: p.elev, elapsedS: p.elapsedS }))), [points]);
  const high = useMemo(() => points.reduce((best, p) => (p.elev > best.elev ? p : best), points[0]), [points]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progressM);
  progressRef.current = progressM;

  // Zoom: a target, and the eased value drawn (cut with reduced motion).
  const [zoomTarget, setZoomTarget] = useState(0);
  const [zoom, setZoom] = useState(0);
  useEffect(() => {
    if (reducedMotion) {
      setZoom(zoomTarget);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      let done = false;
      setZoom((z) => {
        const next = z + (zoomTarget - z) * Math.min(1, dt / 110);
        if (Math.abs(next - zoomTarget) < 0.004) {
          done = true;
          return zoomTarget;
        }
        return next;
      });
      if (!done) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, zoomTarget]);
  const eased = zoom * zoom * (3 - 2 * zoom);
  const view = ridgeWindow({ totalM, progressM, zoom: eased });
  const here = sampleRidge(points, progressM);
  const clock = clockAt(temporal?.status === "recorded" ? temporal.startTimeUtc : undefined, here.elapsedS, temporal?.timeZone);
  const lineHeight = height - safeBottom;

  // Where things sit, shared by the drawing, the readout and the button.
  const geometry = useMemo(() => {
    const samples = Array.from({ length: SAMPLES + 1 }, (_, k) => sampleRidge(points, view.d0 + (view.span * k) / SAMPLES).elev);
    const { lo, hi } = verticalRange(samples, eased);
    const y = (elev: number) => lineHeight - BASE_GAP - ((elev - lo) / (hi - lo)) * (lineHeight - BASE_GAP - TOP);
    const x = (d: number) => ((d - view.d0) / view.span) * width;
    return { samples, y, x };
  }, [eased, lineHeight, points, view.d0, view.span, width]);
  // Kept clear of the screen's edges, where iOS takes a swipe for Back.
  const markerX = Math.min(width - EDGE_CLEAR, Math.max(EDGE_CLEAR, geometry.x(progressM)));
  const markerY = geometry.y(here.elev);

  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const started = performance.now();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(lineHeight * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(lineHeight * dpr);
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    const { samples, y, x } = geometry;
    const H = lineHeight;
    const W = width;
    const mx = x(progressM);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineJoin = "round";
    const at = (k: number) => (k / SAMPLES) * W;
    const wobble = (k: number) => {
      const d = view.d0 + (view.span * k) / SAMPLES;
      return Math.sin(d * 0.0041) * 0.9 + Math.sin(d * 0.0113) * 0.5;
    };
    const line = (loose = false) => {
      g.beginPath();
      for (let k = 0; k <= SAMPLES; k += 1) g[k ? "lineTo" : "moveTo"](at(k), y(samples[k]) + (loose ? wobble(k) : 0));
    };
    // Ahead of her: paper, hatched ink, an ink line with a second loose stroke.
    g.save();
    g.beginPath();
    g.rect(mx, 0, W - mx, H);
    g.clip();
    line();
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fillStyle = "#fbfaf6";
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = INK;
    g.globalAlpha = 0.24;
    g.lineWidth = 1;
    g.beginPath();
    const shift = ((((view.d0 / view.span) * W) % 7) + 7) % 7;
    for (let hx = -H - shift; hx < W + 7; hx += 7) {
      g.moveTo(hx, H);
      g.lineTo(hx + H * 0.8, 0);
    }
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    line();
    g.stroke();
    g.globalAlpha = 0.45;
    g.lineWidth = 1;
    line(true);
    g.stroke();
    g.restore();
    // Behind her: colour by effort.
    const grades = gradesOf(samples, view.span / SAMPLES);
    g.save();
    g.beginPath();
    g.rect(0, 0, mx, H);
    g.clip();
    for (let k = 0; k < SAMPLES && at(k) <= mx; k += 1) {
      const [r, gg, b] = effortColour(grades[k]);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.beginPath();
      g.moveTo(at(k), y(samples[k]));
      g.lineTo(at(k + 1) + 0.6, y(samples[k + 1]));
      g.lineTo(at(k + 1) + 0.6, H);
      g.lineTo(at(k), H);
      g.fill();
    }
    // Shade under the ridge only: above it is the strip's paper.
    line();
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.clip();
    const shade = g.createLinearGradient(0, H - 70, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = shade;
    g.fillRect(0, 0, mx, H);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(0, 0, mx, H);
    g.clip();
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    line();
    g.stroke();
    g.restore();
    // Kilometre ticks.
    const step = tickStep(view.span);
    g.font = "600 11px ui-sans-serif, system-ui, -apple-system, sans-serif";
    g.textAlign = "center";
    for (let k = Math.ceil(view.d0 / 1000 / step) * step; k * 1000 <= view.d0 + view.span; k += step) {
      const tx = x(k * 1000);
      if (tx < 14 || tx > W - 14) continue;
      g.fillStyle = tx < mx ? "#fff" : INK;
      g.globalAlpha = 0.85;
      g.fillRect(tx - 0.5, H - 22, 1, 5);
      g.fillText(String(k), tx, H - 6);
      g.globalAlpha = 1;
    }
    // Where she stopped, and the high point.
    for (const stop of stops) {
      const sx = x(stop.d);
      if (sx < 4 || sx > W - 4) continue;
      const sy = y(sampleRidge(points, stop.d).elev);
      const done = sx < mx;
      g.beginPath();
      g.arc(sx, sy, 4.5, 0, Math.PI * 2);
      g.fillStyle = done ? "#fff" : PAPER;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = INK;
      g.stroke();
      if (eased > 0.6 && Math.abs(sx - markerX) > 110) {
        g.globalAlpha = (eased - 0.6) / 0.4;
        g.fillStyle = INK;
        g.fillText(`stopped ${stop.minutes} min`, Math.min(W - 60, Math.max(60, sx)), sy - 12);
        g.globalAlpha = 1;
      }
    }
    const hx = x(high.d);
    if (hx > 8 && hx < W - 40 && Math.abs(hx - mx) > 30) {
      const hy = y(high.elev);
      g.fillStyle = g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(hx, hy - 2);
      g.lineTo(hx, hy - 15);
      g.lineTo(hx + 9, hy - 11);
      g.lineTo(hx, hy - 7);
      g.fill();
      g.stroke();
      g.textAlign = "left";
      g.fillText(`${Math.round(high.elev)} m`, hx + 12, hy - 7);
      g.textAlign = "center";
    }
    // The marker, which plays or pauses.
    const radius = dragging ? MARKER + 3 : MARKER;
    g.beginPath();
    g.arc(markerX, markerY, radius + 5, 0, Math.PI * 2);
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fill();
    g.beginPath();
    g.arc(markerX, markerY, radius, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = "#fff";
    g.stroke();
    g.save();
    g.translate(markerX - 10, markerY - 10);
    g.scale(0.84, 0.84);
    g.fillStyle = PAPER;
    g.fill(new Path2D(playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z"));
    g.restore();
    stats.draws += 1;
    stats.ms += performance.now() - started;
  }, [dragging, eased, geometry, high, lineHeight, markerX, markerY, playing, points, progressM, stops, view.d0, view.span, width]);

  // One pointer: the gesture reducer decides; this applies its effects.
  const [gesture, send] = useReducer((state: ReturnType<typeof initialRidgeGesture>, event: RidgeGestureEvent) => reduceRidgeGesture(state, event).state, undefined, initialRidgeGesture);
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  const viewRef = useRef(view);
  viewRef.current = view;
  const hold = useRef(0);
  const lastTapToggle = useRef(0);
  const apply = useCallback(
    (effect: RidgeEffect | undefined) => {
      if (!effect) return;
      if (effect.type === "toggle") {
        lastTapToggle.current = performance.now();
        onToggle();
      } else if (effect.type === "seekTo") onSeek(progressAtX(effect.x, width, viewRef.current));
      else if (effect.type === "scrub") onSeek(scrubBy(progressRef.current, effect.dx, width, viewRef.current, totalM));
      else setZoomTarget(effect.on ? 1 : 0);
    },
    [onSeek, onToggle, totalM, width],
  );
  const dispatch = useCallback(
    (event: RidgeGestureEvent) => {
      const next = reduceRidgeGesture(gestureRef.current, event);
      gestureRef.current = next.state;
      send(event);
      apply(next.effect);
      if (event.type === "up" || event.type === "cancel" || (event.type === "move" && next.state.phase === "pressing" && next.state.moved)) window.clearTimeout(hold.current);
    },
    [apply],
  );
  const localX = (event: React.PointerEvent) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  const localY = (event: React.PointerEvent) => event.clientY - event.currentTarget.getBoundingClientRect().top;

  return (
    <div
      aria-label="Route progress"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={totalM > 0 ? Math.round((progressM / totalM) * 1000) / 10 : 0}
      aria-valuetext={`${clock ? `${clock}, ` : ""}${km(progressM)} of ${km(totalM)} km`}
      className="sketch-ridge"
      data-stops={stops.length}
      data-testid="sketch-ridge"
      data-zoomed={zoomTarget === 1}
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          onToggle();
          return;
        }
        const to = scrubKeyTarget(event, progressRef.current, totalM);
        if (to === null) return;
        event.preventDefault();
        onSeek(to);
      }}
      onLostPointerCapture={(event) => dispatch({ type: "cancel", pointerId: event.pointerId })}
      onPointerCancel={(event) => dispatch({ type: "cancel", pointerId: event.pointerId })}
      onPointerDown={(event) => {
        if (gestureRef.current.phase !== "idle") return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const x = localX(event);
        const onMarker = Math.hypot(x - markerX, localY(event) - markerY) < TAP_RADIUS;
        setDragging(true);
        dispatch({ type: "down", pointerId: event.pointerId, x, onMarker });
        const pointerId = event.pointerId;
        hold.current = window.setTimeout(() => dispatch({ type: "holdElapsed", pointerId }), HOLD_MS);
      }}
      onPointerMove={(event) => dispatch({ type: "move", pointerId: event.pointerId, x: localX(event) })}
      onPointerUp={(event) => {
        setDragging(false);
        dispatch({ type: "up", pointerId: event.pointerId });
      }}
      role="slider"
      style={{ height }}
      tabIndex={0}
    >
      <canvas aria-hidden="true" ref={canvasRef} style={{ width, height: lineHeight }} />
      <p aria-hidden="true" className="sketch-ridge-readout" style={{ left: Math.min(width - 96, Math.max(96, markerX)), top: Math.max(2, markerY - MARKER - 36) }}>
        {clock ? <b>{clock} · </b> : null}
        {km(progressM)} km · {Math.round(here.elev)} m
      </p>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className="sketch-ridge-play"
        ref={playRef}
        onClick={() => {
          // A tap on the marker is played by the gesture; this is the keyboard's and assistive tech's way in.
          if (performance.now() - lastTapToggle.current > 500) onToggle();
        }}
        style={{ left: markerX - 22, top: markerY - 22 }}
        type="button"
      />
    </div>
  );
}
