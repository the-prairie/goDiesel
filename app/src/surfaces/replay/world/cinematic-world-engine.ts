import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { LRUCache } from "3d-tiles-renderer/core";
import { GLTFExtensionsPlugin, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { AgXToneMapping, Color, Mesh, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GoogleRouteNavigatorEngine, GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-route-navigator-engine";
import type { GoogleRouteCameraPose, GoogleRouteGroundingMode } from "@/surfaces/replay/playback/route-navigator-controller";
import type { CinematicRouteTreatment } from "@/surfaces/replay/cinematic/cinematic-route-filament";
import { routeDistanceM } from "@/domain/geometry/route-path";
import { WorldFrame } from "./world-frame";
import { WorldRoute } from "./world-route";
import { WorldAtmosphere } from "./world-atmosphere";
import { createWorldLabels } from "./world-labels";
import { DEFAULT_WORLD_ENVIRONMENT, normalizeEnvironment, WORLD_QUALITY, worldStatus, type WorldEnvironment, type WorldLayers } from "./world-model";

type MountOptions = Parameters<GoogleRouteNavigatorEngine["mount"]>[0];
type Labels = Awaited<ReturnType<typeof createWorldLabels>>;
export interface CinematicWorldEnginePort extends GoogleRouteNavigatorEngine { setEnvironment(environment: WorldEnvironment): void; }
declare global { interface Window { __GODIESEL_CINEMATIC_WORLD_FACTORY__?: () => CinematicWorldEnginePort; } }

export class CinematicWorldEngine implements CinematicWorldEnginePort {
  private abort = new AbortController();
  private renderer?: WebGLRenderer;
  private tiles?: TilesRenderer;
  private frame?: WorldFrame;
  private scene = new Scene();
  private camera = new PerspectiveCamera(54, 1, 0.5, 100_000);
  private controls?: OrbitControls;
  private trace?: WorldRoute;
  private atmosphere?: WorldAtmosphere;
  private labels?: Labels;
  private atmosphereReady = false;
  private shaderFailed = false;
  private labelsStarted = false;
  private labelState: WorldLayers["labels"] = "loading";
  private options?: MountOptions;
  private resizeObserver?: ResizeObserver;
  private animation = 0;
  private readyTimer = 0;
  private layers: WorldLayers = { terrain: "loading", atmosphere: "loading", labels: "loading", route: "loading" };
  private environment = DEFAULT_WORLD_ENVIRONMENT;
  private lastStatus = "";
  private following = true;
  private pose?: GoogleRouteCameraPose;
  private renderedTiles = 0;
  private readyFrames = 0;
  private terrainGaps = false;
  private attribution?: HTMLDivElement;
  private lastAttribution = "";
  private effectiveQuality = this.environment.quality;
  private slowFrames = 0;
  private raycaster = new Raycaster();
  private measuredTarget: number | null = null;
  private lastTargetSample = -Infinity;
  private lastCameraCorrection = 0;

  async mount(options: MountOptions) {
    this.options = options;
    this.publish();
    const { container, route } = options;
    if (!route.replay.replayEligible || route.lifecycle === "planned" || route.replay.geometryStatus !== "ready" || route.route.length < 2) {
      this.fail("This route has no replayable recorded geometry."); return;
    }
    const key = import.meta.env.VITE_WORLD_GOOGLE_MAPS_API_KEY || options.apiKey;
    if (!key) { this.fail("Cinematic world needs a browser key with Google Map Tiles API enabled. Native Replay and Atlas remain available."); return; }
    try {
      const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
      this.renderer = renderer;
      renderer.debug.onShaderError = () => { this.shaderFailed = true; };
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = AgXToneMapping;
      renderer.setClearColor(new Color("#aabdc7"));
      renderer.domElement.dataset.testid = "cinematic-world-canvas";
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute("aria-label", `Cinematic 3D terrain for ${route.name}. Drag to explore; use Replay controls to follow the route.`);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;outline-offset:-4px";
      renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
      container.replaceChildren(renderer.domElement);
      const frame = new WorldFrame(route.centerLat, route.centerLng);
      this.frame = frame;
      this.trace = new WorldRoute(route, frame);
      this.scene.add(this.trace.group);
      this.layers.route = this.trace.grounded ? "ready" : "loading";
      const tiles = new TilesRenderer("https://tile.googleapis.com/v1/3dtiles/root.json");
      this.tiles = tiles;
      const cache = new LRUCache();
      cache.unloadPriorityCallback = tiles.lruCache.unloadPriorityCallback;
      cache.maxBytesSize = 384 * 1024 * 1024;
      cache.minBytesSize = 256 * 1024 * 1024;
      tiles.lruCache = cache;
      tiles.fetchOptions = { signal: this.abort.signal };
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key }));
      const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}world-assets/draco/`);
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, autoDispose: true }));
      tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: this.environment.reducedMotion ? 0 : 200 }));
      tiles.group.matrix.copy(frame.ecefToWorld);
      tiles.group.matrixAutoUpdate = false;
      this.scene.add(tiles.group);
      tiles.setCamera(this.camera);
      tiles.addEventListener("load-model", ({ scene }) => {
        scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          // Bound synchronous BVH work to modest tile meshes; no global prototype mutation.
          if (object.geometry.attributes.position?.count < 12_000 && !object.geometry.boundsTree) {
            computeBoundsTree.call(object.geometry);
            object.raycast = acceleratedRaycast;
          }
          const previous = object.onAfterRender;
          object.onAfterRender = (...args) => { previous.apply(object, args); this.renderedTiles += 1; };
        });
        this.trace?.invalidate();
      });
      tiles.addEventListener("dispose-model", ({ scene }) => scene.traverse((object) => {
        if (object instanceof Mesh && object.geometry.boundsTree) disposeBoundsTree.call(object.geometry);
      }));
      tiles.addEventListener("tile-visibility-change", () => this.trace?.invalidate());
      tiles.addEventListener("load-error", ({ tile }) => {
        if (this.abort.signal.aborted) return;
        if (!tile) this.fail("Google 3D terrain could not load. Check Map Tiles API access, billing and this browser origin.");
        else { this.terrainGaps = true; this.publish(); }
      });
      this.raycaster.firstHitOnly = true;
      const initial = options.initialCamera;
      if (initial) this.setCamera(initial);
      const controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls = controls;
      controls.enableDamping = false;
      controls.minDistance = 20;
      controls.maxDistance = 150_000;
      controls.maxPolarAngle = Math.PI * 0.46;
      if (initial) controls.target.copy(frame.position(initial.center.lat, initial.center.lng, initial.center.altitude ?? route.route[0].elev));
      if (initial) this.setCamera(initial);
      controls.addEventListener("start", () => { if (this.following) options.onCameraInteraction?.(); });
      controls.addEventListener("change", () => {
        if (!this.following) {
          this.camera.near = Math.max(0.5, this.camera.position.distanceTo(controls.target) / 100);
          this.camera.updateProjectionMatrix();
        }
      });
      controls.listenToKeyEvents(renderer.domElement);
      renderer.domElement.addEventListener("keydown", this.onKey);
      this.attribution = document.createElement("div");
      this.attribution.dataset.testid = "cinematic-world-attribution";
      this.attribution.style.cssText = "position:absolute;left:12px;bottom:calc(var(--world-dock-height,180px) + 8px);max-width:calc(100% - 24px);z-index:50;background:rgba(255,255,255,.94);color:#202124;padding:6px 10px;font:11px/1.4 Arial,sans-serif;border-radius:3px;pointer-events:auto";
      container.append(this.attribution);
      this.updateAttribution();
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(container);
      this.applyEnvironment();
      this.resize();
      this.readyTimer = window.setTimeout(() => {
        if (this.layers.terrain !== "ready") this.fail("Photorealistic terrain did not render in time. Use Native Replay or Atlas; no substitute scenery has been loaded.");
      }, 35_000);
      this.atmosphere = new WorldAtmosphere(renderer, this.scene, this.camera, frame.worldToECEF, this.environment,
        route.route.reduce((height, point) => Math.max(height, Number.isFinite(point.elev) ? point.elev : 0), 0));
      void this.atmosphere.load(this.abort.signal).then(() => {
        if (this.abort.signal.aborted) return;
        this.atmosphereReady = true;
        this.layers.atmosphere = "ready";
        this.resize(); this.publish();
      }).catch(() => {
        if (this.abort.signal.aborted) return;
        this.layers.atmosphere = "unavailable";
        renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1;
        this.publish();
      });
      this.startLabels();
      let previous = performance.now();
      const tick = (now: number) => {
        if (this.abort.signal.aborted) return;
        this.animation = requestAnimationFrame(tick);
        const elapsed = now - previous;
        previous = now;
        if (document.hidden) return;
        try {
          this.camera.updateMatrixWorld();
          tiles.update();
          this.scene.updateMatrixWorld(true);
          this.trace?.settle(this.sampleHeight, now);
          if (this.trace?.grounded) this.layers.route = "ready";
          if (this.pose && this.following && now - this.lastTargetSample > 500) {
            this.lastTargetSample = now;
            this.measuredTarget = this.sampleHeight(this.pose.center.lat, this.pose.center.lng, this.pose.center.altitude ?? 0);
            this.setCamera(this.pose);
          }
          this.renderedTiles = 0;
          if (this.atmosphereReady) this.atmosphere?.render(Math.min(0.1, elapsed / 1000));
          else renderer.render(this.scene, this.camera);
          if (this.shaderFailed) { this.shaderFailed = false; throw new Error("World shader could not compile"); }
          this.readyFrames = this.renderedTiles > 0 && tiles.loadProgress > 0.9 ? this.readyFrames + 1 : 0;
          if (this.readyFrames >= 2) { this.layers.terrain = "ready"; window.clearTimeout(this.readyTimer); }
          if (this.layers.terrain === "ready" && this.environment.quality === "balanced") {
            this.slowFrames = elapsed > 50 && elapsed < 500 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
            if (this.slowFrames > 90 && this.effectiveQuality !== "light") { this.effectiveQuality = "light"; this.applyEnvironment(); }
          }
          container.dataset.renderedTileMeshes = String(this.renderedTiles);
          container.dataset.visibleTiles = String(tiles.visibleTiles.size);
          container.dataset.worldLabelCount = String(this.labels?.visibleLabelCount ?? 0);
          container.dataset.cameraMeshCorrectionM = this.lastCameraCorrection.toFixed(1);
          this.updateAttribution(); this.publish();
        } catch {
          if (this.atmosphereReady) {
            this.atmosphereReady = false; this.atmosphere?.dispose();
            this.layers.atmosphere = "unavailable";
            renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1;
            this.publish();
          } else this.fail("The cinematic renderer could not draw this scene. Native Replay and Atlas remain available.");
        }
      };
      this.animation = requestAnimationFrame(tick);
    } catch { this.fail("This browser could not start the cinematic 3D world. Try a WebGL2-capable browser, Native Replay or Atlas."); }
  }

  private onContextLost = (event: Event) => { event.preventDefault(); this.fail("The browser lost its 3D graphics context. Reopen Cinematic world or use Native Replay."); };
  private onKey = (event: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && this.following) this.options?.onCameraInteraction?.();
  };
  private resize = () => {
    if (!this.renderer || !this.options) return;
    const { width, height } = this.options.container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.tiles?.setResolutionFromRenderer(this.camera, this.renderer);
    this.trace?.resize(width, height); this.atmosphere?.resize(width, height);
  };
  private sampleHeight = (lat: number, lng: number, seed: number): number | null => {
    if (!this.frame || !this.tiles?.visibleTiles.size) return null;
    this.raycaster.set(this.frame.position(lat, lng, Math.max(10_000, seed + 2000)), this.frame.normal(lat, lng).negate());
    const hit = this.raycaster.intersectObject(this.tiles.group, true)[0];
    return hit ? this.frame.height(hit.point) : null;
  };
  setCamera(pose: GoogleRouteCameraPose) {
    if (this.pose && Math.abs(this.pose.progressM - pose.progressM) > 500) this.measuredTarget = null;
    this.pose = pose;
    if (!this.frame || !this.following || !this.options) return;
    const recorded = this.options.route.elevationStatus !== "unavailable";
    const height = recorded ? pose.center.altitude ?? this.options.route.route[0].elev : this.measuredTarget ?? pose.center.altitude ?? 0;
    const correction = recorded && this.measuredTarget !== null ? Math.max(-120, Math.min(120, this.measuredTarget - height)) : 0;
    const target = this.frame.camera(this.camera, pose, height + correction);
    this.controls?.target.copy(target);
    // Mesh clearance at the actual camera footprint is a rendering correction, not a recorded value.
    const position = this.camera.position.clone();
    const up = this.frame.normal(pose.center.lat, pose.center.lng);
    this.raycaster.set(position.clone().addScaledVector(up, 1500), up.clone().negate());
    const hit = this.tiles?.visibleTiles.size ? this.raycaster.intersectObject(this.tiles.group, true)[0] : undefined;
    const clearance = hit ? position.sub(hit.point).dot(up) : Infinity;
    this.lastCameraCorrection = Math.max(0, 18 - clearance);
    if (Number.isFinite(this.lastCameraCorrection) && this.lastCameraCorrection > 0) {
      this.camera.position.addScaledVector(up, this.lastCameraCorrection);
      this.camera.lookAt(target); this.camera.updateMatrixWorld();
    }
  }
  setFollowing(following: boolean) { this.following = following; }
  setGrounding(mode: GoogleRouteGroundingMode) { this.trace?.grounding(mode === "mesh"); }
  setCinematicRoute(treatment: CinematicRouteTreatment) {
    this.trace?.update(treatment.focusRatio * (this.options ? routeDistanceM(this.options.route) : 1), treatment.rangeM);
  }
  setRouteReveal(progress: number) { this.trace?.setReveal(Math.max(0, Math.min(1, progress)) * (this.options ? routeDistanceM(this.options.route) : 1)); }
  setEnvironment(environment: WorldEnvironment) {
    const next = normalizeEnvironment(environment);
    if (next.quality !== this.environment.quality) { this.effectiveQuality = next.quality; this.slowFrames = 0; }
    this.environment = next; this.applyEnvironment(); this.startLabels(); this.publish();
  }
  private applyEnvironment() {
    const settings = { ...this.environment, quality: this.effectiveQuality };
    const quality = WORLD_QUALITY[this.effectiveQuality];
    this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    if (this.tiles) this.tiles.errorTarget = quality.errorTarget;
    this.atmosphere?.update(settings); this.labels?.update(settings);
    this.layers.labels = this.environment.labels ? this.labelState : "off";
    if (this.options) this.options.container.dataset.effectiveQuality = this.effectiveQuality;
    this.resize();
  }
  private startLabels() {
    if (this.labelsStarted || !this.tiles || !this.environment.labels || this.abort.signal.aborted) return;
    this.labelsStarted = true;
    void createWorldLabels(this.tiles, this.camera, this.abort.signal, this.environment, (state) => {
      this.labelState = state; this.layers.labels = this.environment.labels ? state : "off"; this.publish();
    }).then((labels) => {
      if (this.abort.signal.aborted) { labels.dispose(); return; }
      this.labels = labels; labels.update({ ...this.environment, quality: this.effectiveQuality });
    }).catch(() => {
      if (!this.abort.signal.aborted) { this.labelState = "unavailable"; this.layers.labels = this.environment.labels ? "unavailable" : "off"; this.publish(); }
    });
  }
  private updateAttribution() {
    if (!this.attribution) return;
    const names = this.tiles?.getAttributions().filter(({ type, value }) => type === "string" && typeof value === "string").map(({ value }) => String(value)).join(" · ") ?? "";
    const terrainText = `Terrain · Google Maps${names ? ` · ${names}` : ""}`;
    const text = `${terrainText}|${this.labels?.attribution ?? ""}`;
    if (text === this.lastAttribution) return;
    this.lastAttribution = text;
    // Attribution is text, never provider-controlled innerHTML. It stays visible when the HUD fades.
    this.attribution.replaceChildren();
    const terrain = document.createElement("span"); terrain.translate = false; terrain.textContent = terrainText;
    const roads = document.createElement(this.labels?.defaultSource ? "a" : "span");
    if (roads instanceof HTMLAnchorElement) { roads.href = "https://www.openstreetmap.org/copyright"; roads.target = "_blank"; roads.rel = "noopener noreferrer"; }
    roads.textContent = `Road names · ${this.labels?.attribution ?? "Loading map credits"}`;
    roads.style.textDecoration = "underline";
    this.attribution.append(terrain);
    if (this.labels) this.attribution.append(document.createTextNode(" | "), roads);
    this.attribution.append(document.createTextNode(" | Light & clouds · simulated"));
  }
  private publish() {
    if (!this.options || this.abort.signal.aborted) return;
    let state = worldStatus(this.layers);
    if (state === "ready" && (this.terrainGaps || this.effectiveQuality !== this.environment.quality)) state = "partial";
    const missing = Object.entries(this.layers).filter(([, value]) => value === "unavailable").map(([key]) => key);
    const message = state === "loading" ? "Entering real photorealistic terrain." : [
      "Cinematic world", missing.length ? `${missing.join(" and ")} unavailable` : "",
      Object.values(this.layers).includes("loading") ? "Additional layers are still loading" : "",
      this.terrainGaps ? "Some terrain tiles are unavailable" : "",
      this.effectiveQuality !== this.environment.quality ? "Light quality selected to keep the flight responsive" : "",
    ].filter(Boolean).join(" · ");
    const signature = JSON.stringify([state, message, this.layers]);
    if (signature === this.lastStatus) return;
    this.lastStatus = signature;
    Object.assign(this.options.container.dataset, { worldTerrain: this.layers.terrain, worldAtmosphere: this.layers.atmosphere, worldLabels: this.layers.labels, worldRoute: this.layers.route });
    this.options.onStatus({ state, message } as GoogleRouteNavigatorStatus);
  }
  private fail(message: string) {
    this.layers.terrain = "unavailable";
    if (this.options) this.options.container.dataset.worldTerrain = "unavailable";
    this.options?.onStatus({ state: "unavailable", message });
    this.abort.abort(); cancelAnimationFrame(this.animation); window.clearTimeout(this.readyTimer);
  }
  destroy() {
    this.abort.abort(); cancelAnimationFrame(this.animation); window.clearTimeout(this.readyTimer);
    this.resizeObserver?.disconnect(); this.controls?.stopListenToKeyEvents(); this.controls?.dispose();
    this.labels?.dispose(); this.atmosphere?.dispose(); this.tiles?.dispose(); this.trace?.dispose();
    this.renderer?.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer?.domElement.removeEventListener("keydown", this.onKey);
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove();
    this.attribution?.remove(); this.scene.clear();
  }
}
export function createCinematicWorldEngine(): CinematicWorldEnginePort {
  return window.__GODIESEL_CINEMATIC_WORLD_FACTORY__?.() ?? new CinematicWorldEngine();
}
