import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { RouteRegion } from "@/data/route-regions";
import type { QuestRoute, RoutePoint } from "@/domain/routes";
import { cn } from "@/lib/utils";

interface AtlasGlobeProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion) => void;
  onOpenRoute: (route: QuestRoute) => void;
}

interface GlobeRefs {
  renderer?: THREE.WebGLRenderer;
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  root?: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  worldPoint: THREE.Vector3;
  projectedPoint: THREE.Vector3;
  normal: THREE.Vector3;
  anchors: THREE.Mesh[];
  heatLines: THREE.Mesh[];
  labelBounds: Array<{ width: number; height: number }>;
  viewport: { width: number; height: number };
  frame?: number;
  cameraDistance: number;
  targetRotation: THREE.Vector2;
  drag: {
    active: boolean;
    moved: boolean;
    x: number;
    y: number;
    rotX: number;
    rotY: number;
  };
}

const EARTH_TEXTURE =
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg";

function latLngToVector3(lat: number, lng: number, radius = 2.42) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * Math.cos(latRad) * Math.cos(lngRad),
  );
}

function makeGlobeLine(points: THREE.Vector3[], color: number, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
  });

  return new THREE.Line(geometry, material);
}

function makeGlobeCircle(latitude: number | null, longitude: number | null) {
  const points: THREE.Vector3[] = [];
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

function routeToGlobeHeatPoints(route: QuestRoute, radius = 2.505) {
  const points = route.route;
  if (points.length < 2) return [];
  const sampleEvery = Math.max(1, Math.ceil(points.length / 140));

  return points
    .filter((_, index) => index % sampleEvery === 0 || index === points.length - 1)
    .map((point: RoutePoint) => latLngToVector3(point.lat, point.lng, radius));
}

function makeGlobeHeatLine(route: QuestRoute, regionIndex: number) {
  const points = routeToGlobeHeatPoints(route);
  if (points.length < 2) return null;

  const ride = route.type === "Ride";
  const best = route.replay.bestInEarth;
  const curve = new THREE.CatmullRomCurve3(points);
  const material = new THREE.MeshBasicMaterial({
    color: best ? 0xe8d49a : ride ? 0xff6a3d : 0x00d7ff,
    transparent: true,
    opacity: best ? 0.82 : 0.62,
    blending: THREE.AdditiveBlending,
    depthTest: true,
  });
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(
      curve,
      Math.min(260, Math.max(16, points.length * 2)),
      best ? 0.0075 : 0.0055,
      5,
      false,
    ),
    material,
  );

  line.userData.regionIndex = regionIndex;
  line.userData.baseOpacity = best ? 0.82 : 0.62;

  return line;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if ("map" in material && material.map instanceof THREE.Texture) {
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
}: AtlasGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedRegionRef = useRef<RouteRegion | undefined>(selectedRegion);
  const selectedRegionName = selectedRegion?.name;
  const onSelectRegionRef = useRef(onSelectRegion);
  const refs = useRef<GlobeRefs>({
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    worldPoint: new THREE.Vector3(),
    projectedPoint: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    anchors: [],
    heatLines: [],
    labelBounds: [],
    viewport: { width: 1, height: 1 },
    cameraDistance: 6.4,
    targetRotation: new THREE.Vector2(-0.22, -0.72),
    drag: {
      active: false,
      moved: false,
      x: 0,
      y: 0,
      rotX: 0,
      rotY: 0,
    },
  });

  const totalKm = useMemo(
    () => regions.reduce((sum, region) => sum + region.totalKm, 0),
    [regions],
  );

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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.35, state.cameraDistance);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const root = new THREE.Group();
    root.rotation.set(state.targetRotation.x, state.targetRotation.y, 0);
    scene.add(root);

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(2.38, 96, 64),
      new THREE.MeshBasicMaterial({ color: 0x10242c }),
    );
    root.add(globe);

    new THREE.TextureLoader().load(
      EARTH_TEXTURE,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.offset.x = 0.25;
        const material = globe.material as THREE.MeshBasicMaterial;
        material.map = texture;
        material.color.set(0x9fb7ac);
        material.needsUpdate = true;
      },
      undefined,
      () => {
        (globe.material as THREE.MeshBasicMaterial).color.set(0x10242c);
      },
    );

    root.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(2.52, 96, 64),
        new THREE.MeshBasicMaterial({
          color: 0x0b4e83,
          transparent: true,
          opacity: 0.12,
          side: THREE.BackSide,
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
    regions.forEach((region, regionIndex) => {
      region.routes.forEach((route) => {
        const line = makeGlobeHeatLine(route, regionIndex);
        if (!line) return;
        root.add(line);
        state.heatLines.push(line);
      });

      const anchor = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 12, 8),
        new THREE.MeshBasicMaterial({
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
      state.labelBounds = labelRefs.current.map((label) => ({
        width: label?.offsetWidth || 130,
        height: label?.offsetHeight || 26,
      }));
    }

    function updateLabels() {
      const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const cameraFacing = new THREE.Vector3(0, 0, 1);
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
          box.right > 8 &&
          box.left < state.viewport.width - 8 &&
          box.bottom > 8 &&
          box.top < state.viewport.height - 8;
        const show = item.visible && inFrame && (item.selected || !collides);
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
        const material = line.material as THREE.MeshBasicMaterial;
        const region = regions[line.userData.regionIndex];
        const selected = selectedRegionRef.current?.name === region?.name;
        const target = selected ? 0.92 : line.userData.baseOpacity;
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
      state.targetRotation.x = THREE.MathUtils.clamp(
        state.drag.rotX + dy * 0.004,
        -1.1,
        1.1,
      );
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
      canvasEl.setPointerCapture?.(event.pointerId);
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
      canvasEl.releasePointerCapture?.(event.pointerId);
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
      state.cameraDistance = THREE.MathUtils.clamp(
        state.cameraDistance + event.deltaY * 0.004,
        4.8,
        9.2,
      );
    }

    resize();
    syncLabelBounds();
    animate();
    canvasEl.addEventListener("pointerdown", handlePointerDown);
    canvasEl.addEventListener("pointermove", handlePointerMove);
    canvasEl.addEventListener("pointerup", handlePointerUp);
    canvasEl.addEventListener("pointercancel", handlePointerUp);
    canvasEl.addEventListener("click", handleClick);
    canvasEl.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("resize", resize);

    return () => {
      if (state.frame) cancelAnimationFrame(state.frame);
      canvasEl.removeEventListener("pointerdown", handlePointerDown);
      canvasEl.removeEventListener("pointermove", handlePointerMove);
      canvasEl.removeEventListener("pointerup", handlePointerUp);
      canvasEl.removeEventListener("pointercancel", handlePointerUp);
      canvasEl.removeEventListener("click", handleClick);
      canvasEl.removeEventListener("wheel", handleWheel);
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
    if (!selectedRegion || !state.targetRotation) return;
    state.targetRotation.x = -(selectedRegion.centerLat * Math.PI) / 360;
    state.targetRotation.y = -((selectedRegion.centerLng + 12) * Math.PI) / 180;
  }, [selectedRegionName, selectedRegion]);

  return (
    <div className="relative min-h-[520px] overflow-hidden rounded-md border border-border bg-[radial-gradient(circle_at_50%_45%,hsl(var(--primary)/0.1),transparent_42%),linear-gradient(145deg,#02070a,#07131a)]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full cursor-grab touch-none"
        aria-label="Interactive route globe"
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
              "pointer-events-auto absolute hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground shadow-xl backdrop-blur transition-colors hover:border-primary hover:text-foreground data-[active=true]:border-primary data-[active=true]:text-primary",
            )}
          >
            <span className="size-2 rounded-full bg-primary shadow-[0_0_18px_hsl(var(--primary))]" />
            {region.name} · {region.routes.length}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div className="text-xs font-semibold uppercase text-primary">
          Quest globe
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {regions.length} regions · {totalKm.toFixed(0)} km of completed traces
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-md border border-border bg-background/80 px-4 py-3 text-xs leading-5 text-muted-foreground backdrop-blur">
        Drag to rotate. Scroll to zoom. Pick a route region to open its memories.
      </div>
      <div className="absolute bottom-4 right-4 hidden rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase text-primary sm:block">
        Heat traces, not pins
      </div>
    </div>
  );
}
