import type { Camera, Object3D } from "three";

/**
 * Compatibility boundary for pinned 3d-tiles-renderer 0.5.2.
 * MVTGlyphs.update() recenters using _lastCamera before its first onAfterRender.
 * Supply the real camera explicitly; never synthesize a render or change a prototype.
 * Revisit this boundary when upgrading the dependency.
 */
export function bindWorldGlyphCamera(glyph: Object3D, camera: Camera): void {
  if (!("_lastCamera" in glyph)) {
    throw new Error("MVT glyph camera contract changed; review the pinned adapter.");
  }
  (glyph as Object3D & { _lastCamera: Camera | null })._lastCamera = camera;
}
