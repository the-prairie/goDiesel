import { describe, expect, it } from "vitest";

import { frontCorners, handoverTransform, SHOP } from "@/labs/sketch/moment-handover";

// Where a drawing point lands on screen under the scene's world transform.
function land(t: { tx: number; ty: number; s: number; ox: number; oy: number; left: number; top: number }, x: number, y: number) {
  return { x: t.left + t.ox + t.tx + t.s * (x - t.ox), y: t.top + t.oy + t.ty + t.s * (y - t.oy) };
}

describe("the hand-over from the map to the drawn shop", () => {
  const viewport = { width: 402, height: 874 };

  it("puts the drawn shop front's ground corners on the real front's", () => {
    const front = { left: 120, right: 300, ground: 610 };
    const t = handoverTransform(front, viewport)!;
    const w = t.width;
    const h = t.height;
    const a = land(t, (SHOP.left / 360) * w, (SHOP.ground / 640) * h);
    const b = land(t, (SHOP.right / 360) * w, (SHOP.ground / 640) * h);
    expect(a.x).toBeCloseTo(120, 6);
    expect(b.x).toBeCloseTo(300, 6);
    expect(a.y).toBeCloseTo(610, 6);
    expect(b.y).toBeCloseTo(610, 6);
  });

  it("sizes the drawing like the scene does: full width on a phone, 9:16", () => {
    const t = handoverTransform({ left: 0, right: 100, ground: 500 }, viewport)!;
    expect(t.width).toBe(402);
    expect(t.height).toBeCloseTo((402 * 16) / 9, 6);
    expect(t.top).toBeCloseTo(874 / 2 - t.height / 2, 6);
  });

  it("does not line up with a front that is off screen or edge-on", () => {
    expect(handoverTransform({ left: 200, right: 202, ground: 500 }, viewport)).toBeNull();
    expect(handoverTransform({ left: -900, right: -400, ground: 500 }, viewport)).toBeNull();
    expect(handoverTransform({ left: 100, right: 300, ground: 2000 }, viewport)).toBeNull();
  });

  it("finds the front's two ground corners either side of its middle, along the wall", () => {
    // Facing south: the wall runs east-west.
    const [a, b] = frontCorners({ at: { lng: 135.77, lat: 35 }, facingDeg: 180, frontM: 20 });
    expect(a.lat).toBeCloseTo(35, 7);
    expect(b.lat).toBeCloseTo(35, 7);
    const metres = Math.abs(a.lng - b.lng) * 111320 * Math.cos((35 * Math.PI) / 180);
    expect(metres).toBeCloseTo(20, 1);
    expect((a.lng + b.lng) / 2).toBeCloseTo(135.77, 9);
  });

  it("takes a 20 m front when the placement has no width", () => {
    const [a, b] = frontCorners({ at: { lng: 135.77, lat: 35 }, facingDeg: 90 });
    expect(Math.abs(a.lng - b.lng)).toBeLessThan(1e-9);
    expect(Math.abs(a.lat - b.lat) * 110540).toBeCloseTo(20, 1);
  });
});
