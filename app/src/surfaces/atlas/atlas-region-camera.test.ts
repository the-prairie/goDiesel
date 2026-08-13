import { describe, expect, it } from "vitest";

import {
  atlasCameraFrame,
  atlasRegionTransitionDurationSeconds,
  atlasRouteTransitionDurationSeconds,
  atlasViewportInsets,
} from "@/surfaces/atlas/atlas-region-camera";

describe("atlas regional camera framing", () => {
  it("reserves desktop space for the heading, inspector, and future route tray", () => {
    const insets = atlasViewportInsets(1440, 900);
    const frame = atlasCameraFrame(25_000, { width: 1440, height: 900 }, Math.PI / 3, insets);

    expect(insets).toEqual({ top: 96, right: 420, bottom: 220, left: 260 });
    expect(frame.rangeM).toBeGreaterThan(50_000);
    expect(frame.horizontalOffsetRatio).toBeLessThan(0);
    expect(frame.verticalOffsetRatio).toBeLessThan(0);
  });

  it("keeps a useful mobile frame despite the bottom route surface", () => {
    const insets = atlasViewportInsets(390, 844);
    const frame = atlasCameraFrame(4_000, { width: 390, height: 844 }, Math.PI / 3, insets);

    expect(insets.top).toBe(170);
    expect(insets.bottom).toBe(280);
    expect(frame.rangeM).toBeGreaterThan(8_000);
    expect(Number.isFinite(frame.rangeM)).toBe(true);
  });

  it("inflates degenerate one-route bounds to a stable minimum range", () => {
    const frame = atlasCameraFrame(0, { width: 1280, height: 800 }, Math.PI / 3, {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    expect(frame.rangeM).toBeGreaterThanOrEqual(800);
  });

  it("caps reduced motion at 150 milliseconds", () => {
    expect(atlasRegionTransitionDurationSeconds(false)).toBe(1.15);
    expect(atlasRegionTransitionDurationSeconds(true)).toBeLessThanOrEqual(0.15);
    expect(atlasRouteTransitionDurationSeconds(false)).toBeLessThan(0.7);
    expect(atlasRouteTransitionDurationSeconds(true)).toBeLessThanOrEqual(0.15);
  });
});
