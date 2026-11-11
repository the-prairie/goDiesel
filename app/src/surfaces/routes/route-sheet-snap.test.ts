import { describe, expect, it } from "vitest";
import { routeSheetHeights, snapRouteSheet, type RouteSheetPosition } from "./route-sheet-snap";

// A 390x844 phone: the guide fills the viewport above the 82 px bottom bar.
const viewport = { viewportHeight: 844, containerHeight: 762 };
const snap = (from: RouteSheetPosition, dragPx: number, velocityPxPerMs = 0) =>
  snapRouteSheet({ from, dragPx, velocityPxPerMs, ...viewport });

describe("route sheet snap", () => {
  it("measures the three stops the sheet already renders", () => {
    expect(routeSheetHeights(844, 762)).toEqual({ peek: 256, half: 844 * 0.58, expanded: 750 });
  });

  it("never lets half exceed expanded on a short container", () => {
    const heights = routeSheetHeights(390, 300);
    expect(heights.half).toBeLessThanOrEqual(heights.expanded);
    expect(heights.peek).toBeLessThanOrEqual(heights.half);
  });

  it.each(["peek", "half", "expanded"] as const)("stays at %s for a tap or a small slow drag", (from) => {
    expect(snap(from, 0)).toBe(from);
    expect(snap(from, -20, -0.05)).toBe(from);
    expect(snap(from, 20, 0.05)).toBe(from);
  });

  it("releases a slow drag at the nearest stop", () => {
    expect(snap("peek", -240)).toBe("half");
    expect(snap("peek", -460)).toBe("expanded");
    expect(snap("expanded", 260)).toBe("half");
    expect(snap("expanded", 470)).toBe("peek");
    expect(snap("half", -170)).toBe("expanded");
    expect(snap("half", 170)).toBe("peek");
  });

  it("carries a flick one stop in its direction even when the drag was short", () => {
    expect(snap("peek", -30, -0.8)).toBe("half");
    expect(snap("half", -30, -0.8)).toBe("expanded");
    expect(snap("expanded", 30, 0.8)).toBe("half");
    expect(snap("half", 30, 0.8)).toBe("peek");
  });

  it("lets a fast long flick travel past the middle stop", () => {
    expect(snap("peek", -200, -2.5)).toBe("expanded");
    expect(snap("expanded", 200, 2.5)).toBe("peek");
  });

  it("never snaps against the direction of a flick", () => {
    expect(snap("half", -40, 0.9)).toBe("peek");
    expect(snap("expanded", -10, 1)).toBe("half");
    expect(snap("peek", 10, -1)).toBe("half");
  });

  it("clamps drags beyond the outer stops", () => {
    expect(snap("peek", 600)).toBe("peek");
    expect(snap("expanded", -600)).toBe("expanded");
    expect(snap("peek", 400, 3)).toBe("peek");
    expect(snap("expanded", -400, -3)).toBe("expanded");
  });
});
