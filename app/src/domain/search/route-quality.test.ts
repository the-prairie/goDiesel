import { describe, it, expect } from "vitest";
import { assessRoute } from "./route-quality";
import type { ExternalRoute } from "./external";
const quality = (lines: ExternalRoute["lines"]) =>
  assessRoute({ lines, distanceKm: 1, distanceKind: "mapped" });
describe("mapped topology", () => {
  it("joins reversed members by their actual vertices and recognizes a loop", () => {
    expect(
      quality([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 1],
          [1, 0],
        ],
        [
          [1, 1],
          [0, 0],
        ],
      ]).shape,
    ).toBe("loop");
  });
  it("recognizes open paths and branches without making a loop promise", () => {
    expect(
      quality([
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      ]).shape,
    ).toBe("open");
    expect(
      quality([
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        [
          [1, 0],
          [1, 1],
        ],
      ]).shape,
    ).toBe("branched");
  });
  it("never connects close endpoints or crossings without shared vertices", () => {
    const r = quality([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1.000001, 0],
        [2, 0],
      ],
    ]);
    expect(r).toMatchObject({ shape: "disconnected", components: 2 });
    expect(
      quality([
        [
          [0, 0],
          [1, 1],
        ],
        [
          [0, 1],
          [1, 0],
        ],
      ]).components,
    ).toBe(2);
  });
  it("counts repeated edges once and flags source-distance discrepancies", () => {
    const r = assessRoute({
      lines: [
        [
          [0, 0],
          [0.01, 0],
          [0, 0],
        ],
      ],
      distanceKm: 5,
      distanceKind: "source",
    });
    expect(r.mappedKm).toBeCloseTo(1.112, 2);
    expect(r.distanceMismatch).toBe(true);
  });
});
