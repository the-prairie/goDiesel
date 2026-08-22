import { describe, expect, it } from "vitest";

import { parseStagedRoute } from "@/data/studio-repository";

describe("staged route repository", () => {
  it("uses the production strict parser", () => {
    expect(() => parseStagedRoute({ slug: "unsafe" }, "unsafe")).toThrow("mid_idx");
  });
});
