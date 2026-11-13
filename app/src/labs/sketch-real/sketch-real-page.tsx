// SPIKE (lab only, not a feature, not linked from anywhere): can the sketch
// BE the real city? Google's Photorealistic 3D Tiles, rendered by our own
// Cesium, drawn as a line drawing by a post-process shader, with a reveal
// to the real colour. Whether Google's Map Tiles policies allow a
// non-photorealistic shader over their tiles is UNVERIFIED: see
// docs/plans/2026-11-13-sketch-world.md before anything like this leaves the lab.

import { useEffect, useRef, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  Matrix4,
  PostProcessStage,
  Transforms,
  Viewer,
  createGooglePhotorealistic3DTileset,
  type Cesium3DTileset,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { routes } from "@/data/routes";
import { MAX_ROUTE_POINTS, SKETCH_REAL_SHADER } from "@/labs/sketch-real/sketch-real-shader";
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
    __sketchReal?: { viewer: Viewer; tileset: Cesium3DTileset; stats(): Stats; setView(view: View): void };
  }
}

/** Camera for a view near the start of route 064, looking along it. */
function cameraFor(viewer: Viewer, view: View) {
  const ahead = TRACE[2];
  const heading = Math.atan2((ahead.lng - START.lng) * Math.cos((START.lat * Math.PI) / 180), ahead.lat - START.lat);
  // Stand back from the start, against the way the route goes.
  const back = view === "street" ? 0.0016 : 0.006;
  const lat = START.lat - Math.cos(heading) * back;
  const lng = START.lng - (Math.sin(heading) * back) / Math.cos((START.lat * Math.PI) / 180);
  viewer.camera.setView({
    // Heights above the ellipsoid: Kyoto's streets sit near 90 m on it.
    destination: Cartesian3.fromDegrees(lng, lat, view === "street" ? 150 : 700),
    orientation: { heading, pitch: CesiumMath.toRadians(view === "street" ? -18 : -38), roll: 0 },
  });
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
  const [reveal, setReveal] = useState(0);
  const [corridor, setCorridor] = useState(false);
  const [status, setStatus] = useState("Loading Google's 3D city");
  const uniforms = useRef({ reveal: 0, corridor: 0 });
  uniforms.current = { reveal: reveal / 100, corridor: corridor ? 1 : 0 };

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
    const viewer = new Viewer(container, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      requestRenderMode: false,
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
    viewer.scene.globe.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    viewer.scene.fog.enabled = false;
    cameraFor(viewer, new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("view") === "aerial" ? "aerial" : "street");

    // The route on the ground plane around its start, in metres, east and north.
    const local = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(START.lng, START.lat, 0));
    const toLocal = Matrix4.inverseTransformation(local, new Matrix4());
    const step = Math.max(1, Math.ceil(TRACE.length / MAX_ROUTE_POINTS));
    const routeLocal = TRACE.filter((_, index) => index % step === 0)
      .slice(0, MAX_ROUTE_POINTS)
      .map((point) => {
        const p = Matrix4.multiplyByPoint(toLocal, Cartesian3.fromDegrees(point.lng, point.lat, 0), new Cartesian3());
        return new Cartesian2(p.x, p.y);
      });
    while (routeLocal.length < MAX_ROUTE_POINTS) routeLocal.push(new Cartesian2(0, 0));
    const eyeToLocal = new Matrix4();
    const stage = new PostProcessStage({
      fragmentShader: SKETCH_REAL_SHADER,
      uniforms: {
        u_reveal: () => uniforms.current.reveal,
        u_corridor: () => uniforms.current.corridor,
        u_radius: () => 70,
        u_detail: () => 1,
        u_routeCount: () => Math.min(MAX_ROUTE_POINTS, Math.ceil(TRACE.length / step)),
        u_route: () => routeLocal,
        u_eyeToLocal: () => Matrix4.multiply(toLocal, viewer.camera.inverseViewMatrix, eyeToLocal),
      },
    });
    viewer.scene.postProcessStages.add(stage);

    let tileset: Cesium3DTileset | undefined;
    createGooglePhotorealistic3DTileset(
      { key, onlyUsingWithGoogleGeocoder: true },
      {
        // The Google logo and the data attributions from the tiles, on screen.
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 16,
        // Modest memory: one neighbourhood, nothing kept beyond this session.
        cacheBytes: 384 * 1024 * 1024,
        maximumCacheOverflowBytes: 128 * 1024 * 1024,
      },
    )
      .then((loaded) => {
        if (disposed) return;
        tileset = loaded;
        viewer.scene.primitives.add(loaded);
        loaded.allTilesLoaded.addEventListener(() => {
          if (firstCompleteMs === null) firstCompleteMs = Math.round(performance.now() - started);
          setStatus("");
        });
        window.__sketchReal = {
          viewer,
          tileset: loaded,
          stats: () => ({
            firstCompleteMs,
            ...tileTraffic(),
            tilesetBytes: loaded.totalMemoryUsageInBytes,
            heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
          }),
          setView: (view) => cameraFor(viewer, view),
        };
      })
      .catch(() => {
        if (!disposed) setStatus("Google's 3D tiles could not load.");
      });

    return () => {
      disposed = true;
      delete window.__sketchReal;
      viewer.destroy();
      void tileset;
    };
  }, []);

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
