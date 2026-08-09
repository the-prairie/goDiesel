import { describe, expect, it } from "vitest";

import { normalizeSingleRouteSlug } from "@/config/single-route-microsite";

describe("normalizeSingleRouteSlug", () => {
  it("accepts activity identifiers used by shared routes", () => {
    expect(normalizeSingleRouteSlug(" 3519505225411091950 ")).toBe(
      "3519505225411091950",
    );
  });

  it.each([undefined, "", "route/other", "route?other", "../route"])(
    "rejects an unsafe route slug: %s",
    (value) => {
      expect(normalizeSingleRouteSlug(value)).toBeUndefined();
    },
  );
});
