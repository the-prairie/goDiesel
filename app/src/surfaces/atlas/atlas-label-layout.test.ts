import { describe, expect, it } from "vitest";
import { visibleAtlasLabels } from "./atlas-label-layout";

const viewport = { width: 1200, height: 800 };
const label = (name: string, y: number, priority = 1, selected = false) => ({
  name, x: 600, y, width: 200, height: 44, priority, selected, visible: true,
});

describe("Atlas label collision layout", () => {
  it("reserves the actual touch-target height and a gap in dense regions", () => {
    expect(visibleAtlasLabels([
      label("Crete", 400, 8), label("Bologna", 440, 3), label("London", 450),
    ], viewport)).toEqual(["Crete"]);
    expect(visibleAtlasLabels([label("Crete", 400, 8), label("London", 452)], viewport))
      .toEqual(["Crete", "London"]);
  });

  it("places the selected region first even when another region has higher priority", () => {
    expect(visibleAtlasLabels([label("Crete", 400, 200), label("London", 400, 1, true)], viewport))
      .toEqual(["London"]);
  });

  it("never displays an unmeasured label", () => {
    expect(visibleAtlasLabels([{ ...label("London", 400), width: 0, height: 0 }], viewport))
      .toEqual([]);
  });

  it("breaks equal priorities consistently regardless of input ordering", () => {
    const labels = [label("London", 400), label("Bologna", 400)];
    expect(visibleAtlasLabels(labels, viewport)).toEqual(["Bologna"]);
    expect(visibleAtlasLabels([...labels].reverse(), viewport)).toEqual(["Bologna"]);
  });
});
