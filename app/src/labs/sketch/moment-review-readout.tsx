import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

// A readout for her phone in review mode: numbers nobody has measured on her
// real iPhone yet, in plain words on one line she can read out or paste.

const WINDOW_MS = 3_000;

export interface FrameSample {
  at: number;
  ms: number;
}

export interface Readout {
  frame: { averageMs: number; worstMs: number; frames: number };
  tiles: { wanted: number; drawn: number };
  lastTileMs: number | null;
  triangles: number;
  canvas: { width: number; height: number };
  dpr: number;
  contextLosses: number;
}

/** The average and worst frame of those that ended in the last window. */
export function frameStats(frames: readonly FrameSample[], now: number, windowMs: number) {
  const recent = frames.filter((frame) => now - frame.at <= windowMs);
  if (!recent.length) return { averageMs: 0, worstMs: 0, frames: 0 };
  return { averageMs: recent.reduce((sum, frame) => sum + frame.ms, 0) / recent.length, worstMs: Math.max(...recent.map((frame) => frame.ms)), frames: recent.length };
}

export function readoutLine(r: Readout) {
  const round = (n: number) => Math.round(n);
  return [
    `frame ${round(r.frame.averageMs)} ms average, ${round(r.frame.worstMs)} ms worst (last ${WINDOW_MS / 1000} s)`,
    `tiles ${r.tiles.drawn} of ${r.tiles.wanted} drawn`,
    `last tile ${r.lastTileMs === null ? "none yet" : `${round(r.lastTileMs)} ms`}`,
    `triangles ${round(r.triangles).toLocaleString("en-US")}`,
    `canvas ${r.canvas.width}×${r.canvas.height} at ${r.dpr}x`,
    `context lost ${r.contextLosses} time${r.contextLosses === 1 ? "" : "s"}`,
  ].join(" · ");
}

type EdgeStatsLike = { wanted: number; drawn: number; triangles: number; lastTileMs: number | null };

export default function ReviewReadout({ map }: { map: MapLibreMap }) {
  const [line, setLine] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const canvas = map.getCanvas();
    let losses = 0;
    const lost = () => (losses += 1);
    canvas.addEventListener("webglcontextlost", lost);
    const frames: FrameSample[] = [];
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frames.push({ at: now, ms: now - last });
      last = now;
      while (frames.length && now - frames[0].at > WINDOW_MS) frames.shift();
      frame = requestAnimationFrame(tick);
    });
    const timer = window.setInterval(() => {
      const edges = (map.getLayer("building-edges") as unknown as { implementation?: { stats?: () => EdgeStatsLike } } | undefined)?.implementation?.stats?.();
      setLine(
        readoutLine({
          frame: frameStats(frames, performance.now(), WINDOW_MS),
          tiles: { wanted: edges?.wanted ?? 0, drawn: edges?.drawn ?? 0 },
          lastTileMs: edges?.lastTileMs ?? null,
          triangles: edges?.triangles ?? 0,
          canvas: { width: canvas.width, height: canvas.height },
          dpr: window.devicePixelRatio || 1,
          contextLosses: losses,
        }),
      );
    }, 1000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      canvas.removeEventListener("webglcontextlost", lost);
    };
  }, [map]);
  const copy = () => {
    void navigator.clipboard?.writeText(line).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="moment-readout" data-testid="sketch-readout">
      <p aria-label="Phone readout" aria-live="off" className="moment-readout-line">
        {line || "Measuring…"}
      </p>
      <button className="moment-readout-copy" onClick={copy} type="button">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
