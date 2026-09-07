import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { MVTGlyphs } from "3d-tiles-renderer/three/plugins";
import { bindWorldGlyphCamera } from "./world-glyph-camera";

// Execute the pinned library's actual recenter method without a canvas/font mock.
const recenter = (MVTGlyphs.prototype as unknown as { _recenter(this: Group): void })._recenter;

describe("MVT camera initialization before the first rendered frame", () => {
  it("recenters using the real camera before onAfterRender has ever run", () => {
    const glyph = Object.assign(new Group(), { _lastCamera: null });
    const camera = new PerspectiveCamera();
    camera.position.set(12, 34, 56);
    camera.updateMatrixWorld();
    bindWorldGlyphCamera(glyph, camera);
    expect(() => recenter.call(glyph)).not.toThrow();
    expect(glyph.position.toArray()).toEqual([12, 34, 56]);
  });
  it("preserves parent transforms and follows the same moving camera", () => {
    const parent = new Group();
    parent.position.set(100, -200, 30);
    parent.rotation.z = Math.PI / 3;
    const glyph = Object.assign(new Group(), { _lastCamera: null });
    parent.add(glyph);
    parent.updateMatrixWorld(true);
    const camera = new PerspectiveCamera();
    bindWorldGlyphCamera(glyph, camera);
    for (const point of [[400, 50, 1000], [-20, 40, 200]]) {
      camera.position.fromArray(point); camera.updateMatrixWorld();
      recenter.call(glyph);
      expect(glyph.getWorldPosition(new Vector3()).distanceTo(camera.position)).toBeLessThan(1e-8);
    }
  });
  it("fails explicitly when a dependency upgrade changes the compatibility contract", () => {
    expect(() => bindWorldGlyphCamera(new Group(), new PerspectiveCamera())).toThrow("contract changed");
  });
});
