import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_BAND_PX,
  CONTROL_TARGET_PX,
  attributionCorners,
  realmLayout,
  rectsIntersect,
  type Rect,
} from "@/labs/overland/model/realm-layout";

const PHONE = { width: 390, height: 844, safe: { top: 47, right: 0, bottom: 34, left: 0 } };
const DESKTOP = { width: 1440, height: 900, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
const LANDSCAPE = { width: 844, height: 390, safe: { top: 0, right: 47, bottom: 21, left: 47 } };

function inside(inner: Rect, outer: Rect) {
  return inner.left >= outer.left && inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width && inner.top + inner.height <= outer.top + outer.height;
}

describe("attributionCorners", () => {
  it("are the two bottom corners of the map, a band tall, meeting in the middle", () => {
    const [left, right] = attributionCorners(DESKTOP);
    expect(left).toEqual({ left: 0, top: 900 - ATTRIBUTION_BAND_PX, width: 720, height: ATTRIBUTION_BAND_PX });
    expect(right).toEqual({ left: 720, top: 900 - ATTRIBUTION_BAND_PX, width: 720, height: ATTRIBUTION_BAND_PX });
    // The fixture's provider credit sits 4 px from the bottom, 24 px tall.
    expect(ATTRIBUTION_BAND_PX).toBeGreaterThanOrEqual(32);
  });
});

describe("realmLayout", () => {
  for (const [name, viewport] of Object.entries({ PHONE, DESKTOP, LANDSCAPE })) {
    it(`keeps the text box and the controls clear of the attribution corners (${name})`, () => {
      const layout = realmLayout(viewport, 96);
      for (const corner of attributionCorners(viewport)) {
        expect(rectsIntersect(layout.textBox, corner)).toBe(false);
        expect(rectsIntersect(layout.controls, corner)).toBe(false);
      }
      const safe = {
        left: viewport.safe.left,
        top: viewport.safe.top,
        width: viewport.width - viewport.safe.left - viewport.safe.right,
        height: viewport.height - viewport.safe.top - viewport.safe.bottom,
      };
      expect(inside(layout.textBox, safe)).toBe(true);
      expect(inside(layout.controls, safe)).toBe(true);
      expect(rectsIntersect(layout.textBox, layout.controls)).toBe(false);
      expect(layout.controls.height).toBeGreaterThanOrEqual(CONTROL_TARGET_PX);
    });
  }

  it("is as wide as a phone allows and a readable measure on a desktop", () => {
    expect(realmLayout(PHONE, 96).textBox.width).toBe(390 - 2 * 12);
    expect(realmLayout(DESKTOP, 96).textBox.width).toBeLessThanOrEqual(480);
  });

  it("keeps the controls above a home indicator taller than the band", () => {
    const tall = { ...PHONE, safe: { ...PHONE.safe, bottom: 60 } };
    const { controls } = realmLayout(tall, 96);
    expect(controls.top + controls.height).toBeLessThanOrEqual(844 - 60);
  });
});

describe("rectsIntersect", () => {
  it("treats touching edges as clear", () => {
    expect(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 5, height: 5 })).toBe(false);
    expect(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 9, top: 9, width: 5, height: 5 })).toBe(true);
  });
});
