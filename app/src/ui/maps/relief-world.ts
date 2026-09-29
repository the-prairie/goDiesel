import maplibregl, { type MapOptions } from "maplibre-gl";
import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";
import { recordedPointAt, recordedThreadSegments } from "@/domain/geometry/recorded-thread";
import { reliefHistoryLines, type ReliefLineRoute } from "@/ui/maps/relief-lines";
import { applyReliefCartography, applyReliefSky, attachRelief, DEM_SOURCE_ID, RELIEF_PALETTE, type ReliefPalette } from "@/ui/maps/relief-style";

export type ReliefState = "loading" | "ready" | "partial" | "unavailable";
export type ReliefRoute = ReliefLineRoute;
/** An editorial anchor on the selected route, placed by recorded distance upstream. */
export interface ReliefMark { id: string; kind: "chapter" | "scene"; lat: number; lng: number }
export const RELIEF_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
let nextWorldId = 0;
const line = (trace: RoutePoint[], properties: Record<string, unknown> = {}) => ({
  type: "Feature" as const, properties,
  geometry: { type: "LineString" as const, coordinates: trace.map(p => [p.lng, p.lat]) },
});
const point = (p: RoutePoint) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } });

/** Owns the canvas, loaded tiles and layers across story → Replay. No playback state. */
export class ReliefWorld {
  readonly map: maplibregl.Map;
  readonly host: HTMLDivElement;
  state: ReliefState = "loading";
  viewBearing?: number;
  private built = false;
  private terrainStarted = false;
  private terrainReceived = false;
  private disposed = false;
  private listeners = new Set<(state: ReliefState) => void>();
  private routes: ReliefRoute[] = [];
  private selectedSlug?: string;
  private trace: RoutePoint[] = [];
  private gaps: RouteDiscontinuityEvidence[] = [];
  private progressM?: number;
  private marks: ReliefMark[] = [];
  private position: RoutePoint | null = null;
  private marker: HTMLDivElement;
  private markerTransform = "";
  private timer: number;
  private observer: ResizeObserver;

  constructor(container: HTMLElement, options: Partial<MapOptions> = {}, readonly palette: ReliefPalette = RELIEF_PALETTE) {
    this.host = document.createElement("div");
    // MapLibre's unlayered CSS sets position:relative. Explicit dimensions keep
    // this transferred canvas full-height regardless of the consumer's layers.
    this.host.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    this.host.dataset.reliefWorld = String(++nextWorldId);
    container.append(this.host);
    this.map = new maplibregl.Map({
      container: this.host, style: RELIEF_STYLE_URL, attributionControl: false,
      dragPan: false, dragRotate: false, pitchWithRotate: false, scrollZoom: false,
      touchZoomRotate: false, doubleClickZoom: false, keyboard: false,
      maxPitch: 75, canvasContextAttributes: { preserveDrawingBuffer: true }, ...options,
    });
    const map = this.map;
    this.marker = document.createElement("div");
    this.marker.className = "relief-world-position";
    this.marker.hidden = true;
    this.marker.setAttribute("aria-hidden", "true");
    this.host.append(this.marker);
    map.on("render", this.projectPosition);
    map.on("move", this.projectPosition);
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("styledata", this.build);
    map.on("load", this.build);
    map.on("error", this.onError);
    map.on("sourcedata", this.onSourceData);
    // Route first. Terrain is attached only after the first actual paint settles.
    map.once("idle", this.startTerrain);
    this.timer = window.setTimeout(() => {
      if (this.state === "loading") this.report(this.built ? "partial" : "unavailable");
    }, 15000);
    this.observer = new ResizeObserver(() => map.resize());
    this.observer.observe(container);
  }

  private report(state: ReliefState) {
    if (this.disposed || this.state === state) return;
    this.state = state;
    this.listeners.forEach(listener => listener(state));
  }

  subscribe(listener: (state: ReliefState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private onError = (event: maplibregl.ErrorEvent) => {
    if ((event as maplibregl.ErrorEvent & { sourceId?: string }).sourceId === DEM_SOURCE_ID) {
      this.report("partial");
    } else if (!this.built) this.report("unavailable");
  };

  private onSourceData = (event: maplibregl.MapSourceDataEvent) => {
    if (event.sourceId === "relief-route" && event.tile && this.trace.length && event.isSourceLoaded && !this.terrainStarted) {
      // The route's first painted frame is sufficient; waiting for all vector
      // tiles to reach idle unnecessarily serializes the two network sources.
      this.map.once("render", () => requestAnimationFrame(this.startTerrain));
    }
    if (event.sourceId !== DEM_SOURCE_ID) return;
    // Tile completion events have no sourceDataType in MapLibre 5.24. A source
    // "content" event merely announces TileJSON; it is not elevation evidence.
    if (event.tile?.dem) this.terrainReceived = true;
    if (this.terrainStarted && this.terrainReceived && event.isSourceLoaded) this.report("ready");
  };

  private startTerrain = () => {
    if (this.disposed || !this.built || this.terrainStarted) return;
    this.terrainStarted = true;
    this.map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1.35 });
    applyReliefSky(this.map);
    if (this.terrainReceived && this.map.isSourceLoaded(DEM_SOURCE_ID)) this.report("ready");
  };

  private build = () => {
    if (this.built || this.disposed) return;
    const map = this.map, palette = this.palette;
    if (!map.getStyle()?.layers) return;
    this.built = true; // Set before style mutations: styledata can be synchronous.
    applyReliefCartography(map, palette);
    attachRelief(map, palette);
    for (const id of ["relief-history", "relief-route", "relief-travelled", "relief-ends", "relief-position", "relief-marks"]) {
      map.addSource(id, { type: "geojson", data: empty() });
    }
    const addLine = (id: string, source: string, color: string, low: number, high: number, opacity = 1) => {
      map.addLayer({ id, type: "line", source,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 8, low, 13, high], "line-opacity": opacity },
      });
    };
    addLine("relief-history-casing", "relief-history", palette.routeCasing, 4, 7, 0.75);
    addLine("relief-history-line", "relief-history", palette.routeHistory, 1.9, 3.4);
    addLine("relief-route-casing", "relief-route", palette.routeCasing, 5.5, 9, 0.92);
    addLine("relief-route-line", "relief-route", palette.route, 2.4, 5);
    addLine("relief-travelled-line", "relief-travelled", palette.routeTravelled, 2.4, 5);
    map.addLayer({ id: "relief-ends", type: "circle", source: "relief-ends",
      paint: { "circle-radius": 5, "circle-color": palette.routeCasing, "circle-stroke-width": 2, "circle-stroke-color": palette.route },
    });
    // Chapters are filled with the route's own colour; a captured scene is an
    // open ink ring, because it is another author's capture, not the recording.
    map.addLayer({ id: "relief-marks", type: "circle", source: "relief-marks",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 14, 6.5],
        "circle-color": ["match", ["get", "kind"], "scene", palette.routeCasing, palette.route],
        "circle-stroke-width": ["match", ["get", "kind"], "scene", 2.5, 2],
        "circle-stroke-color": ["match", ["get", "kind"], "scene", "#1d1b16", palette.routeCasing],
        "circle-pitch-alignment": "viewport",
      },
    });
    const canvas = map.getCanvas();
    canvas.setAttribute("tabindex", "-1"); canvas.setAttribute("aria-hidden", "true");
    canvas.removeAttribute("aria-label"); canvas.removeAttribute("role");
    this.pushRoutes();
    this.pushProgress();
    this.pushMarks();
  };

  setMarks(marks: ReliefMark[]) {
    this.marks = marks;
    this.pushMarks();
  }

  private pushMarks() {
    if (!this.built) return;
    (this.map.getSource("relief-marks") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.marks.map(mark => ({
        type: "Feature" as const, properties: { id: mark.id, kind: mark.kind },
        geometry: { type: "Point" as const, coordinates: [mark.lng, mark.lat] },
      })),
    });
  }

  setRoutes(routes: ReliefRoute[], selectedSlug?: string, selectedTrace?: RoutePoint[], gaps: RouteDiscontinuityEvidence[] = []) {
    this.routes = routes;
    this.selectedSlug = selectedSlug;
    this.trace = selectedTrace ?? routes.find(route => route.slug === selectedSlug)?.trace ?? [];
    this.gaps = gaps;
    this.pushRoutes();
    this.pushProgress();
  }

  private pushRoutes() {
    if (!this.built) return;
    const data = (id: string, features: ReturnType<typeof line>[] | ReturnType<typeof point>[]) => {
      (this.map.getSource(id) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    };
    data("relief-history", reliefHistoryLines(this.routes, this.selectedSlug).map(r => line(r.trace, { slug: r.slug })));
    data("relief-route", recordedThreadSegments(this.trace, this.gaps).map(segment => line(segment)));
    data("relief-ends", this.trace.length ? [point(this.trace[0]), point(this.trace.at(-1)!)] : []);
  }

  setProgress(distanceM?: number) {
    if (this.progressM === distanceM) return;
    this.progressM = distanceM;
    this.pushProgress();
  }

  private pushProgress() {
    if (!this.built) return;
    const at = this.progressM === undefined ? null : recordedPointAt(this.trace, this.progressM, this.gaps);
    this.position = at;
    this.projectPosition();
    (this.map.getSource("relief-position") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: at ? [point(at)] : [] });
    const travelled = at ? this.trace.filter(p => p.d < at.d).concat(at) : [];
    (this.map.getSource("relief-travelled") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: recordedThreadSegments(travelled, this.gaps).map(segment => line(segment)) });
  }

  private projectPosition = () => {
    if (!this.position) { this.marker.hidden = true; return; }
    const p = this.map.project([this.position.lng, this.position.lat]);
    this.marker.hidden = !Number.isFinite(p.x) || !Number.isFinite(p.y);
    const transform = `translate(${p.x - 9}px, ${p.y - 9}px)`;
    if (transform === this.markerTransform) return;
    this.markerTransform = transform;
    this.marker.style.transform = transform;
  };

  attach(container: HTMLElement) {
    container.append(this.host);
    this.observer.disconnect();
    this.observer.observe(container);
    this.map.resize();
  }

  explore(enabled: boolean) {
    for (const handler of [this.map.dragPan, this.map.dragRotate, this.map.scrollZoom, this.map.touchZoomRotate]) {
      if (enabled) handler.enable(); else handler.disable();
    }
    this.map.getCanvas().style.cursor = enabled ? "grab" : "";
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.listeners.clear();
    this.map.remove();
    this.host.remove();
  }
}

// One bounded handover, consumed by matching route only. Never a second player.
let handover: { world: ReliefWorld; slug: string; timer: number } | undefined;
export function carryReliefWorld(world: ReliefWorld, slug: string) {
  if (handover) { clearTimeout(handover.timer); handover.world.destroy(); }
  world.host.remove();
  const timer = window.setTimeout(() => {
    if (handover?.world === world) { world.destroy(); handover = undefined; }
  }, 10000);
  handover = { world, slug, timer };
}
export function takeReliefWorld(slug: string) {
  if (!handover) return undefined;
  const saved = handover;
  clearTimeout(saved.timer);
  handover = undefined;
  if (saved.slug !== slug) { saved.world.destroy(); return undefined; }
  return saved.world;
}
