import { Box3, Matrix4, Mesh, Raycaster, Vector3, type Object3D } from "three";

interface SurfaceModel {
  source: Object3D;
  errorM: number;
  meshes: Array<{ query: Mesh; bounds: Box3 }>;
}
export interface WorldSurfaceHit { point: Vector3; geometricErrorM: number; }

/**
 * Collision/grounding queries have a different job from the render frustum.
 * Keep a bounded index of the already-loaded geometry, including off-screen
 * camera support. Query-only meshes share geometry/materials and are NEVER added
 * to the scene. Their fixed ENU matrices survive visibility/fade transitions.
 * This owns no GPU resource, provider payload, persistent cache, or source height.
 */
export class WorldSurfaceIndex {
  private readonly models = new Map<Object3D, SurfaceModel>();
  private ordered: SurfaceModel[] = [];
  private dirty = false;
  private readonly ray = new Raycaster();
  constructor(private readonly tilesToWorld: Matrix4) { this.ray.firstHitOnly = true; }
  revision = 0;
  get size() { return this.models.size; }

  add(scene: Object3D, errorM: number) {
    if (!Number.isFinite(errorM) || errorM < 0) return;
    const model: SurfaceModel = { source: scene, errorM, meshes: [] };
    const visit = (node: Object3D, parentWorld: Matrix4) => {
      if (node.matrixAutoUpdate) node.updateMatrix();
      const world = new Matrix4().multiplyMatrices(parentWorld, node.matrix);
      if (node instanceof Mesh) {
        const query = new Mesh(node.geometry, node.material);
        query.matrixAutoUpdate = false;
        query.matrixWorld.copy(world);
        query.raycast = node.raycast;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) {
          const bounds = node.geometry.boundingBox.clone().applyMatrix4(world).expandByScalar(0.01);
          if ([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) model.meshes.push({ query, bounds });
        }
      }
      for (const child of node.children) visit(child, world);
    };
    visit(scene, this.tilesToWorld);
    this.models.set(scene, model); this.dirty = true; this.revision++;
  }
  remove(scene: Object3D) { if (this.models.delete(scene)) { this.dirty = true; this.revision++; } }
  clear() { this.models.clear(); this.ordered = []; this.dirty = false; }

  /** Sightlines use nearest physical geometry; they must not skip a wall to find a finer distant tile. */
  obstruction(origin: Vector3, target: Vector3, maximumErrorM = 4, endMarginM = 4): number | null {
    const distance = origin.distanceTo(target);
    if (!Number.isFinite(distance) || distance <= endMarginM) return null;
    this.ray.set(origin, target.clone().sub(origin).normalize());
    this.ray.near = 0.05; this.ray.far = distance - endMarginM;
    let nearest = Infinity;
    for (const model of this.models.values()) {
      if (model.errorM > maximumErrorM) continue;
      for (const {query, bounds} of model.meshes) {
        if (!this.ray.ray.intersectsBox(bounds)) continue;
        const hit = this.ray.intersectObject(query, false)[0];
        if (hit) nearest = Math.min(nearest, hit.distance);
      }
    }
    this.ray.near = 0; this.ray.far = Infinity;
    return Number.isFinite(nearest) ? nearest : null;
  }

  cast(origin: Vector3, direction: Vector3, maximumErrorM = 8): WorldSurfaceHit | null {
    if (!Number.isFinite(maximumErrorM) || maximumErrorM < 0 ||
      ![...origin.toArray(), ...direction.toArray()].every(Number.isFinite) || direction.lengthSq() === 0) return null;
    if (this.dirty) { this.ordered = [...this.models.values()].sort((a,b) => a.errorM-b.errorM); this.dirty = false; }
    this.ray.set(origin, direction.clone().normalize());
    let best: WorldSurfaceHit | null = null;
    let distance = Infinity;
    for (const model of this.ordered) {
      // A continent-scale fallback must never win over a detailed cached road.
      // Among equally fine hits take the upper surface for camera clearance.
      if (model.errorM > maximumErrorM || best && model.errorM > best.geometricErrorM) break;
      for (const { query, bounds } of model.meshes) {
        if (!this.ray.ray.intersectsBox(bounds)) continue;
        const hit = this.ray.intersectObject(query, false)[0];
        if (hit && hit.distance < distance) {
          distance = hit.distance;
          best = { point: hit.point.clone(), geometricErrorM: model.errorM };
        }
      }
    }
    return best;
  }
}
