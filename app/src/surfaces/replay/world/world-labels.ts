import { DefaultMVTAnnotationsDriver, MVTAnnotationsPlugin, MVTOverlay, PMTilesOverlay, MVTGlyphs } from "3d-tiles-renderer/three/plugins";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import type { PerspectiveCamera } from "three";
import { labelFeature, labelText, WORLD_QUALITY, type WorldEnvironment, type LayerState } from "./world-model";

class RoadLabels extends DefaultMVTAnnotationsDriver {
  constructor(private readonly onDecoded: () => void) { super(); }
  enabled = true;
  readonly visibleLabels = new Set<object>();
  override onLabelsUpdate(added: object[], removed: object[]) {
    for (const item of removed) this.visibleLabels.delete(item);
    for (const item of added) this.visibleLabels.add(item);
    super.onLabelsUpdate(added, removed);
  }
  override filterAnnotation(layer: string, properties: Record<string, unknown>, type: number) {
    this.onDecoded();
    return labelFeature(layer, properties, type);
  }
  override getText(properties: Record<string, unknown>) { return labelText(properties); }
  override isAnnotationEnabled() { return this.enabled; }
  override getAnnotationRank(annotation: object) {
    const properties = (annotation as { properties?: Record<string, unknown> }).properties ?? {};
    const rank = Number(properties.rank ?? properties.scalerank ?? 500);
    return Number.isFinite(rank) ? Math.max(0, Math.min(4095, rank)) : 500;
  }
}

/** Resolve TileJSON each session; OpenFreeMap's dated vector URL must not be hardcoded. */
export async function resolveVectorSource(source: string, signal: AbortSignal) {
  if (!source.startsWith("https://")) throw new Error("Vector sources require HTTPS");
  if (/\.pmtiles(?:\?|$)/.test(source)) return { url: source, pmtiles: true, maxzoom: 14 };
  if (source.includes("{z}")) return { url: source, pmtiles: false, maxzoom: 14 };
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error("Vector map metadata unavailable");
  const json: unknown = await response.json();
  const data = json as { tiles?: unknown; maxzoom?: unknown };
  if (!Array.isArray(data.tiles) || typeof data.tiles[0] !== "string" || !data.tiles[0].includes("{z}")) {
    throw new Error("Vector map metadata has no tile template");
  }
  const url = new URL(data.tiles[0], source).href.replaceAll("%7B", "{").replaceAll("%7D", "}");
  if (!url.startsWith("https://")) throw new Error("Vector tiles require HTTPS");
  return { url, pmtiles: false, maxzoom: typeof data.maxzoom === "number" ? Math.max(0, Math.min(16, Math.floor(data.maxzoom))) : 14 };
}

export async function createWorldLabels(
  tiles: TilesRenderer, camera: PerspectiveCamera, signal: AbortSignal,
  environment: WorldEnvironment, onState: (state: LayerState) => void,
) {
  const source = import.meta.env.VITE_WORLD_VECTOR_SOURCE || "https://tiles.openfreemap.org/planet";
  const attribution = import.meta.env.VITE_WORLD_VECTOR_SOURCE
    ? import.meta.env.VITE_WORLD_VECTOR_ATTRIBUTION
    : "OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors";
  if (!attribution) throw new Error("Custom vector sources require attribution");
  const configuration = await resolveVectorSource(source, signal);
  signal.throwIfAborted();
  const Overlay = configuration.pmtiles ? PMTilesOverlay : MVTOverlay;
  const overlay = new Overlay({ url: configuration.url, levels: configuration.maxzoom + 1, resolution: 128 });
  overlay.fetchOptions = { signal };
  const originalFetch = overlay.fetch.bind(overlay);
  overlay.fetch = async (url, options) => {
    try {
      const response = await originalFetch(url, { ...options, signal });
      if (!response.ok) throw new Error("Road labels unavailable");
      return response;
    } catch (error) {
      if (!signal.aborted) onState("unavailable");
      throw error;
    }
  };
  const driver = new RoadLabels(() => { if (!signal.aborted) onState("ready"); });
  const plugin = new MVTAnnotationsPlugin({ overlay, camera, driver, resolution: 35 });
  const update = (next: WorldEnvironment) => {
    const budget = WORLD_QUALITY[next.quality].labelBudget;
    plugin.maxSettleTimeMs = budget;
    plugin.maxOccupancyUpdateTimeMs = budget / 2;
    plugin.maxParseTimeMs = budget;
    // Road glyphs straddle the terrain surface. Ghost the occluded half instead of clipping the text.
    driver.labels.drawMode = MVTGlyphs.DrawMode.DRAW_THROUGH;
    driver.icons.drawMode = MVTGlyphs.DrawMode.OBSCURED;
    driver.icons.size = 10;
    // MVT glyph fades use seconds, unlike tile fades which use milliseconds.
    driver.labels.fadeInDuration = driver.icons.fadeInDuration = next.reducedMotion ? 0 : 0.2;
    driver.labels.fadeOutDuration = driver.icons.fadeOutDuration = next.reducedMotion ? 0 : 0.2;
    driver.enabled = next.labels;
    driver.group.visible = next.labels;
    driver.needsUpdate = true;
  };
  update(environment);
  // Register only after metadata is ready: async plugin init errors must not escape unobserved.
  try {
    overlay.init();
    await overlay.whenReady();
    signal.throwIfAborted();
    tiles.registerPlugin(plugin);
  } catch (error) {
    driver.dispose(); overlay.imageSource.dispose(); throw error;
  }
  let disposed = false;
  return { update, attribution, defaultSource: !import.meta.env.VITE_WORLD_VECTOR_SOURCE, get visibleLabelCount() { return driver.visibleLabels.size; }, dispose: () => {
    if (disposed) return;
    disposed = true;
    tiles.unregisterPlugin(plugin);
    // MVTOverlay owns no dispose method in 0.5.2; its image source owns the caches.
    overlay.imageSource.dispose();
  } };
}
