import { Mesh, Raycaster, Vector2, type PerspectiveCamera } from "three";

export interface WorldVisualCriticalSet {
  meshes: Mesh[];
  tested: number;
  hits: number;
}

// Denser than the binary view-health probes, but still bounded. The samples
// stay around the route/ground band; sky is intentionally excluded below.
const CRITICAL_PROBES = [
  [0, 0],
  ...[-0.45, -0.2, 0.2, 0.4].flatMap(y => [-0.8, -0.4, 0, 0.4, 0.8].map(x => [x, y])),
] as const;

/**
 * Find the finite set of terrain meshes that actually win visible ground-band
 * samples for this camera. This is a preparation priority hint, not a claim
 * that unselected terrain is absent or may be discarded.
 */
export function collectWorldVisualCriticalMeshes(meshes: readonly Mesh[], camera: PerspectiveCamera, maximum = 24): WorldVisualCriticalSet {
  if (!meshes.length || maximum <= 0) return { meshes: [], tested: 0, hits: 0 };
  const ray = new Raycaster();
  ray.firstHitOnly = true;
  ray.near = camera.near; ray.far = camera.far;
  const counts = new Map<Mesh, number>();
  let tested = 0, hits = 0;
  for (const [index, [x, y]] of CRITICAL_PROBES.entries()) {
    ray.setFromCamera(new Vector2(x, y), camera);
    if (index !== 0 && ray.ray.direction.dot(camera.up) >= -0.005) continue;
    tested++;
    const hit = ray.intersectObjects(meshes as Mesh[], false)[0];
    if (!hit || !(hit.object instanceof Mesh)) continue;
    hits++;
    const mesh = hit.object;
    counts.set(mesh, (counts.get(mesh) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, maximum).map(([mesh])=>mesh);
  return { meshes: ranked, tested, hits };
}
