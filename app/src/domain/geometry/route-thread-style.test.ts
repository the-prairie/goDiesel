import { describe, expect, it } from "vitest";

import { ROUTE_THREAD_STYLE } from "@/domain/geometry/route-thread-style";

describe("ROUTE_THREAD_STYLE", () => {
  it("uses the Weathered Atlas cartographic palette", () => {
    expect(ROUTE_THREAD_STYLE).toEqual({
      color: "#3379df",
      halo: "#f6f2e8",
      marker: "#d95737",
    });
    expect(Object.values(ROUTE_THREAD_STYLE)).not.toContain("#00f19f");
  });
});
