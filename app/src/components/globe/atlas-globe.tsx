import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";

import type { RouteRegion } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/routes";
import { cn } from "@/lib/utils";

interface AtlasGlobeProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion) => void;
  onOpenRoute: (route: RouteSummary) => void;
  className?: string;
}

interface GlobeRefs {
  renderer?: WebGLRenderer;
  scene?: Scene;
  camera?: PerspectiveCamera;
  root?: Group;
  raycaster: Raycaster;
  pointer: Vector2;
  worldPoint: Vector3;
  projectedPoint: Vector3;
  normal: Vector3;
  anchors: Mesh[];
  heatLines: Mesh[];
  labelBounds: Array<{ width: number; height: number }>;
  viewport: { width: number; height: number };
  frame?: number;
  cameraDistance: number;
  targetRotation: Vector2;
  drag: {
    active: boolean;
    moved: boolean;
    x: number;
    y: number;
    rotX: number;
    rotY: number;
  };
}

const EARTH_TEXTURE = `${import.meta.env.BASE_URL}assets/earth-atmos-2048.jpg`;
const DEFAULT_ROTATION = { x: 0.48, y: -0.18 };
const DEFAULT_CAMERA_DISTANCE = 6.4;

function latLngToVector3(lat: number, lng: number, radius = 2.42) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  return new Vector3(
    radius * Math.cos(latRad) * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * Math.cos(latRad) * Math.cos(lngRad),
  );
}

function makeGlobeLine(points: Vector3[], color: number, opacity: number) {
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
  });

  return new Line(geometry, material);
}

function makeGlobeCircle(latitude: number | null, longitude: number | null) {
  const points: Vector3[] = [];
  const steps = 128;

  for (let index = 0; index <= steps; index += 1) {
    if (latitude !== null) {
      const lng = -180 + (360 * index) / steps;
      points.push(latLngToVector3(latitude, lng, 2.425));
    } else if (longitude !== null) {
      const lat = -85 + (170 * index) / steps;
      points.push(latLngToVector3(lat, longitude, 2.425));
    }
  }

  return points;
}

function routeToGlobeHeatPoints(route: RouteSummary, radius = 2.505) {
  const points = route.trace;
  if (points.length < 2) return [];
  const sampleEvery = Math.max(1, Math.ceil(points.length / 140));

  return points
    .filter((_, index) => index % sampleEvery === 0 || index === points.length - 1)
    .map((point: RoutePoint) => latLngToVector3(point.lat, point.lng, radius));
}

function makeGlobeHeatLine(route: RouteSummary, regionIndex: number, density: number) {
  const points = routeToGlobeHeatPoints(route);
  if (points.length < 2) return null;

  const ride = route.type === "Ride";
  const best = route.replay.bestInEarth;
  const baseOpacity = Math.min(0.86, 0.34 + density * 0.42 + (best ? 0.08 : 0));
  const curve = new CatmullRomCurve3(points);
  const material = new MeshBasicMaterial({
    color: best ? 0xe8d49a : ride ? 0xff6a3d : 0x00d7ff,
    transparent: true,
    opacity: baseOpacity,
    blending: AdditiveBlending,
    depthTest: true,
  });
  const line = new Mesh(
    new TubeGeometry(
      curve,
      Math.min(260, Math.max(16, points.length * 2)),
      best ? 0.0075 : 0.0055,
      5,
      false,
    ),
    material,
  );

  line.userData.regionIndex = regionIndex;
  line.userData.baseOpacity = baseOpacity;

  return line;
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if ("map" in material && material.map instanceof Texture) {
          material.map.dispose();
        }
        material.dispose();
      });
    }
  });
}

export function AtlasGlobe({
  regions,
  selectedRegion,
  onSelectRegion,
  onOpenRoute,
  className,
}: AtlasGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedRegionRef = useRef<RouteRegion | undefined>(selectedRegion);
  const selectedRegionName = selectedRegion?.name;
  const onSelectRegionRef = useRef(onSelectRegion);
  const refs = useRef<GlobeRefs>({
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    worldPoint: new Vector3(),
    projectedPoint: new Vector3(),
    normal: new Vector3(),
    anchors: [],
    heatLines: [],
    labelBounds: [],
    viewport: { width: 1, height: 1 },
    cameraDistance: DEFAULT_CAMERA_DISTANCE,
    targetRotation: new Vector2(DEFAULT_ROTATION.x, DEFAULT_ROTATION.y),
    drag: {
      active: false,
      moved: false,
      x: 0,
      y: 0,
      rotX: 0,
      rotY: 0,
    },
  });

  useEffect(() => {
    selectedRegionRef.current = selectedRegion;
  }, [selectedRegion]);

  useEffect(() => {
    onSelectRegionRef.current = onSelectRegion;
  }, [onSelectRegion]);

  useEffect(() => {
    const state = refs.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasEl = canvas;

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.35, state.cameraDistance);
    const renderer = new WebGLRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const root = new Group();
    root.rotation.set(state.targetRotation.x, state.targetRotation.y, 0);
    scene.add(root);

    const globe = new Mesh(
      new SphereGeometry(2.38, 96, 64),
      new MeshBasicMaterial({ color: 0x10242c }),
    );
    root.add(globe);

    new TextureLoader().load(
      EARTH_TEXTURE,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = RepeatWrapping;
        texture.offset.x = 0.25;
        const material = globe.material as MeshBasicMaterial;
        material.map = texture;
        material.color.set(0x9fb7ac);
        material.needsUpdate = true;
        canvasEl.dataset.textureStatus = "loaded";
      },
      undefined,
      () => {
        (globe.material as MeshBasicMaterial).color.set(0x10242c);
        canvasEl.dataset.textureStatus = "fallback";
      },
    );

    root.add(
      new Mesh(
        new SphereGeometry(2.52, 96, 64),
        new MeshBasicMaterial({
          color: 0x0b4e83,
          transparent: true,
          opacity: 0.12,
          side: BackSide,
        }),
      ),
    );

    [-60, -30, 0, 30, 60].forEach((lat) =>
      root.add(makeGlobeLine(makeGlobeCircle(lat, null), 0x244663, 0.22)),
    );
    [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].forEach((lng) =>
      root.add(makeGlobeLine(makeGlobeCircle(null, lng), 0x244663, 0.16)),
    );

    state.anchors = [];
    state.heatLines = [];
    const maxRegionRoutes = Math.max(...regions.map((region) => region.routes.length), 1);
    regions.forEach((region, regionIndex) => {
      const density = Math.sqrt(region.routes.length / maxRegionRoutes);
      region.routes.forEach((route) => {
        const line = makeGlobeHeatLine(route, regionIndex, density);
        if (!line) return;
        root.add(line);
        state.heatLines.push(line);
      });

      const anchor = new Mesh(
        new SphereGeometry(0.085, 12, 8),
        new MeshBasicMaterial({
          color: 0x00f19f,
          transparent: true,
          opacity: 0,
          depthTest: false,
        }),
      );
      anchor.position.copy(latLngToVector3(region.centerLat, region.centerLng, 2.47));
      anchor.userData.regionIndex = regionIndex;
      root.add(anchor);
      state.anchors.push(anchor);
    });

    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.root = root;
    canvasEl.dataset.heatLines = String(state.heatLines.length);

    function syncInteractionState() {
      canvasEl.dataset.targetRotationX = state.targetRotation.x.toFixed(4);
      canvasEl.dataset.targetRotationY = state.targetRotation.y.toFixed(4);
      canvasEl.dataset.cameraTarget = state.cameraDistance.toFixed(3);
    }
    syncInteractionState();

    function resize() {
      const rect = canvasEl.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      state.viewport = { width, height };
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function syncLabelBounds() {
      state.labelBounds = labelRefs.current.map((label) => {
        if (!label) return { width: 150, height: 30 };
        label.style.visibility = "hidden";
        label.style.display = "flex";
        const bounds = {
          width: label.offsetWidth || 150,
          height: label.offsetHeight || 30,
        };
        label.style.display = "none";
        label.style.visibility = "";
        return bounds;
      });
    }

    function updateLabels() {
      const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const cameraFacing = new Vector3(0, 0, 1);
      const labels = state.anchors
        .map((anchor, index) => {
          const label = labelRefs.current[index];
          if (!label) return null;
          const world = anchor.getWorldPosition(state.worldPoint);
          const projected = state.projectedPoint.copy(world).project(camera);
          const facing = state.normal.copy(world).normalize().dot(cameraFacing);
          const region = regions[index];
          const selected = selectedRegionRef.current?.name === region.name;
          label.dataset.active = selected ? "true" : "false";

          return {
            label,
            bounds: state.labelBounds[index] ?? { width: 130, height: 26 },
            selected,
            priority: (selected ? 100 : 0) + region.routes.length,
            visible: projected.z < 1 && facing > 0.16,
            x: (projected.x * 0.5 + 0.5) * state.viewport.width,
            y: (-projected.y * 0.5 + 0.5) * state.viewport.height,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => b.priority - a.priority);

      labels.forEach((item) => {
        const { width, height } = item.bounds;
        const box = {
          left: item.x - width / 2,
          right: item.x + width / 2,
          top: item.y - height / 2,
          bottom: item.y + height / 2,
        };
        const collides = placed.some(
          (other) =>
            !(
              box.right < other.left ||
              box.left > other.right ||
              box.bottom < other.top ||
              box.top > other.bottom
            ),
        );
        const inFrame =
          box.left > 8 &&
          box.right < state.viewport.width - 8 &&
          box.top > 8 &&
          box.bottom < state.viewport.height - 8;
        const compact = state.viewport.width < 640;
        const blockedByOverlay = compact
          ? box.top < 250
          : box.top < 190 &&
            (box.left < Math.min(520, state.viewport.width * 0.5) ||
              box.right > state.viewport.width - 380);
        const blockedByInspector = selectedRegionRef.current
          ? compact
            ? box.bottom > state.viewport.height * 0.52
            : box.right > state.viewport.width - 390 && box.bottom > 190
          : false;
        const show =
          item.visible &&
          inFrame &&
          !blockedByOverlay &&
          !blockedByInspector &&
          (!compact || placed.length < 5 || item.selected) &&
          (item.selected || !collides);
        item.label.style.left = `${item.x}px`;
        item.label.style.top = `${item.y}px`;
        item.label.style.display = show ? "flex" : "none";
        if (show) placed.push(box);
      });
    }

    function animate() {
      camera.position.z += (state.cameraDistance - camera.position.z) * 0.08;
      root.rotation.x += (state.targetRotation.x - root.rotation.x) * 0.055;
      root.rotation.y += (state.targetRotation.y - root.rotation.y) * 0.055;
      if (!state.drag.active) root.rotation.y += 0.0009;
      state.heatLines.forEach((line) => {
        const material = line.material as MeshBasicMaterial;
        const region = regions[line.userData.regionIndex];
        const selected = selectedRegionRef.current?.name === region?.name;
        const target = selected
          ? 0.94
          : selectedRegionRef.current
            ? line.userData.baseOpacity * 0.3
            : line.userData.baseOpacity;
        material.opacity += (target - material.opacity) * 0.08;
      });
      updateLabels();
      renderer.render(scene, camera);
      state.frame = requestAnimationFrame(animate);
    }

    function setPointer(event: PointerEvent) {
      const rect = canvasEl.getBoundingClientRect();
      state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function regionFromEvent(event: PointerEvent) {
      setPointer(event);
      state.raycaster.setFromCamera(state.pointer, camera);
      const hit = state.raycaster.intersectObjects(state.anchors, false)[0];
      return hit ? regions[hit.object.userData.regionIndex] : undefined;
    }

    function beginDrag(clientX: number, clientY: number) {
      state.drag = {
        active: true,
        moved: false,
        x: clientX,
        y: clientY,
        rotX: state.targetRotation.x,
        rotY: state.targetRotation.y,
      };
    }

    function updateDrag(clientX: number, clientY: number) {
      if (!state.drag.active) return false;
      const dx = clientX - state.drag.x;
      const dy = clientY - state.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.drag.moved = true;
      state.targetRotation.y = state.drag.rotY + dx * 0.006;
      state.targetRotation.x = MathUtils.clamp(
        state.drag.rotX + dy * 0.004,
        -1.1,
        1.1,
      );
      syncInteractionState();
      return true;
    }

    function endDrag() {
      window.setTimeout(() => {
        state.drag.moved = false;
      }, 0);
      state.drag.active = false;
    }

    function handlePointerDown(event: PointerEvent) {
      event.preventDefault();
      beginDrag(event.clientX, event.clientY);
      try {
        canvasEl.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic and assistive pointer events may not own an active pointer.
      }
      canvasEl.style.cursor = "grabbing";
    }

    function handlePointerMove(event: PointerEvent) {
      if (updateDrag(event.clientX, event.clientY)) {
        event.preventDefault();
        canvasEl.style.cursor = "grabbing";
        return;
      }
      canvasEl.style.cursor = regionFromEvent(event) ? "pointer" : "grab";
    }

    function handlePointerUp(event: PointerEvent) {
      if (canvasEl.hasPointerCapture?.(event.pointerId)) {
        canvasEl.releasePointerCapture(event.pointerId);
      }
      canvasEl.style.cursor = "grab";
      endDrag();
    }

    function handleClick(event: MouseEvent) {
      if (state.drag.moved) return;
      const region = regionFromEvent(event as PointerEvent);
      if (region) onSelectRegionRef.current(region);
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      state.cameraDistance = MathUtils.clamp(
        state.cameraDistance + event.deltaY * 0.004,
        3.2,
        9.2,
      );
      syncInteractionState();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const rotationStep = 0.12;
      if (event.key === "ArrowLeft") state.targetRotation.y -= rotationStep;
      else if (event.key === "ArrowRight") state.targetRotation.y += rotationStep;
      else if (event.key === "ArrowUp") {
        state.targetRotation.x = MathUtils.clamp(
          state.targetRotation.x - rotationStep,
          -1.1,
          1.1,
        );
      } else if (event.key === "ArrowDown") {
        state.targetRotation.x = MathUtils.clamp(
          state.targetRotation.x + rotationStep,
          -1.1,
          1.1,
        );
      } else if (event.key === "+" || event.key === "=") {
        state.cameraDistance = MathUtils.clamp(state.cameraDistance - 0.5, 3.2, 9.2);
      } else if (event.key === "-" || event.key === "_") {
        state.cameraDistance = MathUtils.clamp(state.cameraDistance + 0.5, 3.2, 9.2);
      } else return;
      syncInteractionState();
      event.preventDefault();
    }

    resize();
    syncLabelBounds();
    animate();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasEl);
    canvasEl.addEventListener("pointerdown", handlePointerDown);
    canvasEl.addEventListener("pointermove", handlePointerMove);
    canvasEl.addEventListener("pointerup", handlePointerUp);
    canvasEl.addEventListener("pointercancel", handlePointerUp);
    canvasEl.addEventListener("click", handleClick);
    canvasEl.addEventListener("wheel", handleWheel, { passive: false });
    canvasEl.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", resize);

    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      canvasEl.removeEventListener("pointerdown", handlePointerDown);
      canvasEl.removeEventListener("pointermove", handlePointerMove);
      canvasEl.removeEventListener("pointerup", handlePointerUp);
      canvasEl.removeEventListener("pointercancel", handlePointerUp);
      canvasEl.removeEventListener("click", handleClick);
      canvasEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("keydown", handleKeyDown);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      disposeObject(root);
      renderer.dispose();
      state.renderer = undefined;
      state.scene = undefined;
      state.camera = undefined;
      state.root = undefined;
      state.anchors = [];
      state.heatLines = [];
      state.labelBounds = [];
    };
  }, [regions]);

  useEffect(() => {
    const state = refs.current;
    if (!state.targetRotation) return;
    if (!selectedRegion) {
      state.targetRotation.set(DEFAULT_ROTATION.x, DEFAULT_ROTATION.y);
      state.cameraDistance = DEFAULT_CAMERA_DISTANCE;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.dataset.targetRotationX = state.targetRotation.x.toFixed(4);
        canvas.dataset.targetRotationY = state.targetRotation.y.toFixed(4);
        canvas.dataset.cameraTarget = state.cameraDistance.toFixed(3);
      }
      return;
    }
    state.targetRotation.x = (selectedRegion.centerLat * Math.PI) / 180;
    state.targetRotation.y = -(selectedRegion.centerLng * Math.PI) / 180;
    state.cameraDistance = 4.35;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.dataset.targetRotationX = state.targetRotation.x.toFixed(4);
      canvas.dataset.targetRotationY = state.targetRotation.y.toFixed(4);
      canvas.dataset.cameraTarget = state.cameraDistance.toFixed(3);
    }
  }, [selectedRegionName, selectedRegion]);

  return (
    <div
      className={cn(
        "relative min-h-[520px] overflow-hidden rounded-md border border-border bg-[#02070a]",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full cursor-grab touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        aria-label="Interactive route globe"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + -"
        tabIndex={0}
      />
      <div className="pointer-events-none absolute inset-0">
        {regions.map((region, index) => (
          <button
            key={region.name}
            ref={(node) => {
              labelRefs.current[index] = node;
            }}
            type="button"
            onClick={() => onSelectRegion(region)}
            className={cn(
              "pointer-events-auto absolute hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-card/80 px-3 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground shadow-xl backdrop-blur transition-colors hover:border-primary hover:text-foreground data-[active=true]:border-primary data-[active=true]:text-primary",
            )}
          >
            <span className="size-2 rounded-full bg-primary shadow-[0_0_18px_hsl(var(--primary))]" />
            {region.name} · {region.routes.length}
          </button>
        ))}
      </div>
    </div>
  );
}
