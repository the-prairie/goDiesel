import { describe, expect, it } from "vitest";

import { HIT_PT, NEAR_ZOOM, FAR_ZOOM, hitBox, inView, markerShape, motionAt, zoomBlend } from "@/labs/sketch/moment-hologram-math";

describe("the moment marker between city and street", () => {
  it("is a beacon from far, a hologram up close, and one continuous change between", () => {
    expect(zoomBlend(FAR_ZOOM - 1)).toBe(0);
    expect(zoomBlend(FAR_ZOOM)).toBe(0);
    expect(zoomBlend(NEAR_ZOOM)).toBe(1);
    expect(zoomBlend(NEAR_ZOOM + 2)).toBe(1);
    const mid = zoomBlend((FAR_ZOOM + NEAR_ZOOM) / 2);
    expect(mid).toBeCloseTo(0.5, 5);
    // No step anywhere: small zoom changes make small changes.
    for (let z = FAR_ZOOM - 0.5; z < NEAR_ZOOM + 0.5; z += 0.05) expect(Math.abs(zoomBlend(z + 0.05) - zoomBlend(z))).toBeLessThan(0.06);
  });

  it("shortens and thins the beam while the television fades and scales in", () => {
    const metresPerPixel = 2;
    const far = markerShape(0, metresPerPixel);
    const mid = markerShape(0.5, metresPerPixel);
    const near = markerShape(1, metresPerPixel);
    expect(far.tvScale).toBe(0);
    expect(far.tvAlpha).toBe(0);
    expect(near.tvScale).toBe(1);
    expect(near.tvAlpha).toBe(1);
    expect(near.beamLengthM).toBe(0);
    expect(far.beamLengthM).toBeGreaterThan(mid.beamLengthM);
    expect(mid.beamLengthM).toBeGreaterThan(near.beamLengthM);
    expect(far.beamWidthM).toBeGreaterThan(mid.beamWidthM);
    expect(mid.tvScale).toBeGreaterThan(0);
    expect(mid.tvScale).toBeLessThan(1);
  });

  it("keeps the beam the same size on screen from far, so it stands clear above the roofs", () => {
    const a = markerShape(0, 4);
    const b = markerShape(0, 40);
    expect(a.beamLengthM / 4).toBeCloseTo(b.beamLengthM / 40, 6);
    expect(a.beamLengthM / 4).toBeGreaterThanOrEqual(90);
  });

  it("keeps the television big enough to see mid-approach, and its real size at street level", () => {
    // Street zoom in Kyoto: about a fifth of a metre a pixel.
    expect(markerShape(1, 0.2).tv.w).toBeCloseTo(9, 5);
    // Mid-approach: a metre and a half a pixel; never under about 30 px across.
    expect(markerShape(0.5, 1.5).tv.w / 1.5).toBeGreaterThanOrEqual(30);
    const tv = markerShape(1, 0.2).tv;
    expect(tv.liftM).toBeGreaterThan(0);
    expect(tv.h).toBeLessThan(tv.w);
  });

  it("has a 44 pt hit area centred on what she sees", () => {
    expect(HIT_PT).toBe(44);
    expect(hitBox({ x: 100, y: 200 })).toEqual({ left: 78, top: 178, width: 44, height: 44 });
  });

  it("counts as in view only when its hit area or its beam reaches the screen", () => {
    const viewport = { width: 402, height: 874 };
    expect(inView([{ x: 200, y: 400 }], viewport)).toBe(true);
    expect(inView([{ x: -60, y: 400 }], viewport)).toBe(false);
    expect(inView([{ x: -60, y: 400 }, { x: 10, y: 10 }], viewport)).toBe(true);
    expect(inView([{ x: 200, y: 950 }], viewport)).toBe(false);
    expect(inView([], viewport)).toBe(false);
  });

  it("turns, bobs, pulses and scans, and holds still with reduced motion", () => {
    const a = motionAt(1000, false);
    const b = motionAt(2000, false);
    expect(a.spin).not.toBe(b.spin);
    expect(a.bobM).not.toBe(b.bobM);
    expect(a.pulse).not.toBe(b.pulse);
    expect(a.scan).not.toBe(b.scan);
    expect(motionAt(1000, true)).toEqual(motionAt(9000, true));
  });
});
