import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { QuestRoute, RoutePoint } from "@/domain/route";
import { completedEdgeCount, recordedEdges } from "./world-model";
import { WorldFrame } from "./world-frame";

export class WorldRoute {
  readonly group = new Group();
  private readonly edges: Array<[RoutePoint, RoutePoint]>;
  private readonly points: RoutePoint[];
  private readonly heights = new Map<RoutePoint, number>();
  private readonly contextMaterial = new LineMaterial({ color: "#f2ece1", linewidth: 2, transparent: true, opacity: 0.45, depthTest: true });
  private readonly traveledMaterial = new LineMaterial({ color: "#ef684e", linewidth: 3, transparent: true, opacity: 0.95, depthTest: true });
  private readonly context = new LineSegments2(new LineSegmentsGeometry(), this.contextMaterial);
  private readonly traveled = new LineSegments2(new LineSegmentsGeometry(), this.traveledMaterial);
  private readonly marker = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: "#ef684e", depthTest: true }));
  private drawnEdges: Array<[RoutePoint, RoutePoint]> = [];
  private endDistances: number[] = [];
  private cursor = 0;
  private remaining = 0;
  private dirty = true;
  private lastFlush = -Infinity;
  private progress = 0;
  private reveal = Infinity;
  private rangeM = 1000;
  private mesh = true;
  private missingElevation: boolean;

  constructor(route: QuestRoute, private readonly frame: WorldFrame) {
    this.edges = recordedEdges(route);
    this.points = [...new Set(this.edges.flat())];
    this.remaining = this.points.length;
    this.missingElevation = route.elevationStatus === "unavailable" || route.provenance.elevation?.status === "unavailable";
    if (!this.missingElevation) for (const point of this.points) this.heights.set(point, point.elev);
    this.context.frustumCulled = this.traveled.frustumCulled = false;
    this.group.add(this.context, this.traveled, this.marker);
    this.marker.visible = false;
    this.flush(0);
  }
  // Refinement can invalidate on every frame. Restarting at zero starves the
  // rest of a long route; retain the round-robin cursor and refresh its work count.
  invalidate() { this.remaining = this.points.length; }
  get grounded() { return this.heights.size === this.points.length && this.points.length > 0; }
  grounding(mesh: boolean) {
    if (this.mesh === mesh) return;
    this.mesh = mesh;
    if (!this.missingElevation) for (const point of this.points) this.heights.set(point, point.elev);
    this.cursor = 0;
    this.remaining = this.points.length;
    this.dirty = true;
  }
  /** Work budget is per frame; no path-wide synchronous mesh sampling. */
  settle(sample: (lat: number, lng: number, seed: number) => number | null, now: number) {
    const until = performance.now() + 0.8;
    let count = 0;
    while (this.remaining > 0 && count++ < 8 && performance.now() < until) {
      const point = this.points[this.cursor];
      this.cursor = (this.cursor + 1) % this.points.length;
      this.remaining--;
      if (!this.mesh && !this.missingElevation) continue;
      const height = sample(point.lat, point.lng, this.missingElevation ? 0 : point.elev);
      if (height === null) continue;
      // Provider heights are presentation offsets. Never overwrite recorded altitude.
      const next = this.missingElevation ? height : point.elev + Math.max(-120, Math.min(120, height - point.elev));
      if (this.heights.get(point) !== next) { this.heights.set(point, next); this.dirty = true; }
    }
    if (now - this.lastFlush >= 250) this.flush(now);
  }
  private position(point: RoutePoint) {
    return this.frame.position(point.lat, point.lng, (this.heights.get(point) ?? point.elev) + 1.2);
  }
  private flush(now: number) {
    if (!this.dirty) return;
    this.lastFlush = now;
    this.dirty = false;
    this.drawnEdges = this.edges.filter(([a, b]) => this.heights.has(a) && this.heights.has(b));
    this.endDistances = this.drawnEdges.map(([, b]) => b.d);
    const positions = new Float32Array(this.drawnEdges.length * 6);
    this.drawnEdges.forEach(([a, b], index) => {
      this.position(a).toArray(positions, index * 6);
      this.position(b).toArray(positions, index * 6 + 3);
    });
    for (const line of [this.context, this.traveled]) {
      line.geometry.dispose();
      line.geometry = new LineSegmentsGeometry();
      if (positions.length) line.geometry.setPositions(positions);
      line.visible = positions.length > 0;
    }
    this.update(this.progress, this.rangeM);
  }
  update(progress: number, rangeM = 1000) {
    this.progress = progress;
    this.rangeM = rangeM;
    this.context.geometry.instanceCount = completedEdgeCount(this.endDistances, this.reveal);
    this.traveled.geometry.instanceCount = completedEdgeCount(this.endDistances, Math.min(progress, this.reveal));
    const index = Math.min(this.drawnEdges.length - 1, completedEdgeCount(this.endDistances, progress));
    const edge = this.drawnEdges[index];
    const valid = edge && edge[0].d <= progress && edge[1].d >= progress && progress <= this.reveal;
    this.marker.visible = Boolean(valid);
    if (valid) {
      const ratio = edge[1].d === edge[0].d ? 0 : (progress - edge[0].d) / (edge[1].d - edge[0].d);
      this.marker.position.copy(this.position(edge[0])).lerp(this.position(edge[1]), ratio);
      this.marker.scale.setScalar(Math.max(1, Math.min(18, rangeM * 0.0025)));
    }
  }
  setReveal(distanceM: number) { this.reveal = distanceM; this.update(this.progress, this.rangeM); }
  resize(width: number, height: number) {
    this.contextMaterial.resolution.set(width, height);
    this.traveledMaterial.resolution.set(width, height);
  }
  dispose() {
    this.context.geometry.dispose(); this.traveled.geometry.dispose();
    this.contextMaterial.dispose(); this.traveledMaterial.dispose();
    this.marker.geometry.dispose(); this.marker.material.dispose();
    this.group.removeFromParent();
  }
}
