import { describe, expect, it } from "vitest";

import { atlasReturnPath, replayPath } from "@/navigation";

describe("Atlas replay navigation", () => {
  it("carries a selected Atlas URL into Replay", () => {
    const origin = "/atlas?region=Crete%2C+Greece&route=route-123";

    expect(replayPath("route-123", origin)).toBe(
      `/replay/route-123?from=${encodeURIComponent(origin)}`,
    );
  });

  it("only accepts Atlas paths as Replay return destinations", () => {
    expect(atlasReturnPath(new URLSearchParams({ from: "/atlas?region=Crete" }))).toBe(
      "/atlas?region=Crete",
    );
    expect(atlasReturnPath(new URLSearchParams({ from: "https://example.com" }))).toBeUndefined();
    expect(atlasReturnPath(new URLSearchParams({ from: "/admin" }))).toBeUndefined();
  });
});
