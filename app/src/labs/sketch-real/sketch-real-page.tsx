// SPIKE (lab only, not linked from anywhere): Google's Photorealistic 3D
// Tiles drawn as the sketch, with a reveal to the real colour, near the
// start of route 064. It now draws through the same view the sketch world
// hands over to (sketch-real-view); the owner reports Google allows the
// shader (see docs/plans/2026-11-13-sketch-world.md).

import { useEffect, useRef, useState } from "react";

import { routes } from "@/data/routes";
import type { CesiumCameraPose } from "@/labs/sketch/sketch-camera-match";
import type { RealSketchView } from "@/labs/sketch/sketch-real-view";
import { REVEAL_RADIUS_M } from "@/labs/sketch/sketch-reveal";
import "./sketch-real.css";

const SLUG = "17636880071";
const TRACE = routes.find((route) => route.slug === SLUG)!.trace;
const START = TRACE[0];

type View = "street" | "aerial";

interface Stats {
  firstCompleteMs: number | null;
  tileRequests: number;
  tileBytes: number;
  tilesetBytes: number;
  heapBytes: number | null;
}

declare global {
  interface Window {
    __sketchReal?: { stats(): Stats; setView(view: View): void };
  }
}

/** A camera near the start of route 064, standing back against the way it goes. */
function poseFor(view: View, width: number, height: number): CesiumCameraPose {
  const ahead = TRACE[2];
  const heading = Math.atan2((ahead.lng - START.lng) * Math.cos((START.lat * Math.PI) / 180), ahead.lat - START.lat);
  const back = view === "street" ? 0.0016 : 0.006;
  const fov = 36.87;
  return {
    lat: START.lat - Math.cos(heading) * back,
    lng: START.lng - (Math.sin(heading) * back) / Math.cos((START.lat * Math.PI) / 180),
    // Heights above the ellipsoid: Kyoto's streets sit near 70 m on it.
    heightM: view === "street" ? 150 : 700,
    headingDeg: (heading * 180) / Math.PI,
    pitchDeg: view === "street" ? -18 : -38,
    fovDeg: width > height ? (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (width / height)) * 180) / Math.PI : fov,
  };
}

/** Tile traffic this session, from the browser's own resource timing (no URLs kept). */
function tileTraffic() {
  let tileRequests = 0;
  let tileBytes = 0;
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (!entry.name.startsWith("https://tile.googleapis.com/")) continue;
    tileRequests += 1;
    tileBytes += entry.transferSize || entry.encodedBodySize;
  }
  return { tileRequests, tileBytes };
}

export function SketchRealPage() {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<RealSketchView | null>(null);
  const [reveal, setReveal] = useState(0);
  const [corridor, setCorridor] = useState(false);
  const [status, setStatus] = useState("Loading Google's 3D city");

  useEffect(() => {
    const container = host.current;
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!container || !key) {
      setStatus("A Google Map Tiles key is needed for this lab.");
      return;
    }
    performance.setResourceTimingBufferSize(5000);
    const started = performance.now();
    let firstCompleteMs: number | null = null;
    let disposed = false;
    const view = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("view") === "aerial" ? "aerial" : "street";
    void import("@/labs/sketch/sketch-real-view").then(({ createRealSketchView }) => {
      if (disposed) return;
      const real = createRealSketchView({
        container,
        apiKey: key,
        lines: [TRACE.map((point): [number, number] => [point.lng, point.lat])],
        radiusM: 0,
        soft: false,
        paper: [0.984, 0.984, 0.973],
        ink: [0.114, 0.114, 0.122],
        maximumScreenSpaceError: container.clientWidth < 768 ? 24 : 16,
        onTilesStarted: () => undefined,
        onFirstView: () => {
          firstCompleteMs = Math.round(performance.now() - started);
          setStatus("");
        },
        onFailed: () => setStatus("Google's 3D tiles could not load."),
      });
      viewRef.current = real;
      const place = (next: View) => real.setCamera(poseFor(next, container.clientWidth, container.clientHeight));
      place(view);
      window.__sketchReal = {
        stats: () => ({
          firstCompleteMs,
          ...tileTraffic(),
          tilesetBytes: real.stats().tilesetBytes,
          heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        }),
        setView: place,
      };
    });
    return () => {
      disposed = true;
      delete window.__sketchReal;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => viewRef.current?.setFlood(reveal / 100), [reveal]);
  useEffect(() => viewRef.current?.setCorridor(corridor ? REVEAL_RADIUS_M.corridor : 0, false), [corridor]);

  return (
    <div className="sketch-real" data-testid="sketch-real">
      <h1 className="sr-only">Sketch of the real city (spike)</h1>
      <div className="sketch-real-map" ref={host} aria-label="Kyoto, near the start of route 064, drawn from Google's 3D city" role="img" />
      <div className="sketch-real-panel">
        <p className="sketch-real-badge">Spike · lab only</p>
        <label className="sketch-real-row">
          <span>Colour</span>
          <input aria-label="Colour, from sketch to real" max={100} min={0} onChange={(event) => setReveal(Number(event.target.value))} type="range" value={reveal} />
          <output>{reveal}%</output>
        </label>
        <label className="sketch-real-row">
          <input checked={corridor} onChange={(event) => setCorridor(event.target.checked)} type="checkbox" />
          <span>Colour along route 064</span>
        </label>
        <div className="sketch-real-row">
          <button onClick={() => window.__sketchReal?.setView("street")} type="button">
            Street
          </button>
          <button onClick={() => window.__sketchReal?.setView("aerial")} type="button">
            Aerial
          </button>
        </div>
      </div>
      {status ? (
        <p className="sketch-real-status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
