import { describe, expect, it } from "vitest";

import {
  atlasSheetOpens,
  readAtlasPrototypeLayout,
  reduceAtlasSheet,
} from "@/surfaces/atlas/atlas-prototype-layout";

describe("readAtlasPrototypeLayout", () => {
  it("keeps the current Atlas when the flag is absent or unknown", () => {
    expect(readAtlasPrototypeLayout(new URLSearchParams())).toBeNull();
    expect(readAtlasPrototypeLayout(new URLSearchParams("activity=runs"))).toBeNull();
    expect(readAtlasPrototypeLayout(new URLSearchParams("atlasLayout=d"))).toBeNull();
    expect(readAtlasPrototypeLayout(new URLSearchParams("atlasLayout=A"))).toBeNull();
  });

  it("reads the three prototype layouts", () => {
    expect(readAtlasPrototypeLayout(new URLSearchParams("atlasLayout=a"))).toBe("a");
    expect(readAtlasPrototypeLayout(new URLSearchParams("atlasLayout=b"))).toBe("b");
    expect(readAtlasPrototypeLayout(new URLSearchParams("atlasLayout=c"))).toBe("c");
  });
});

describe("atlas sheet detents", () => {
  it("opens a route sheet on region select for A and C, and only after a route tap for B", () => {
    expect(atlasSheetOpens("a", true, false)).toBe(true);
    expect(atlasSheetOpens("c", true, false)).toBe(true);
    expect(atlasSheetOpens("b", true, false)).toBe(false);
    expect(atlasSheetOpens("b", true, true)).toBe(true);
    expect(atlasSheetOpens("a", false, false)).toBe(false);
  });

  it("cycles peek, medium, and large, and swipe down from peek closes", () => {
    expect(reduceAtlasSheet("peek", "cycle")).toBe("medium");
    expect(reduceAtlasSheet("medium", "cycle")).toBe("large");
    expect(reduceAtlasSheet("large", "cycle")).toBe("peek");
    expect(reduceAtlasSheet("closed", "cycle")).toBe("peek");
    expect(reduceAtlasSheet("peek", "expand")).toBe("medium");
    expect(reduceAtlasSheet("medium", "expand")).toBe("large");
    expect(reduceAtlasSheet("large", "collapse")).toBe("medium");
    expect(reduceAtlasSheet("medium", "collapse")).toBe("peek");
    expect(reduceAtlasSheet("peek", "collapse")).toBe("closed");
    expect(reduceAtlasSheet("large", "dismiss")).toBe("closed");
  });
});
