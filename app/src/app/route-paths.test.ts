import { describe, expect, it } from "vitest";

import {
  atlasReturnPath,
  replayPath,
  replayReturnPath,
} from "@/app/route-paths";

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

  it("accepts only the matching route story as a Replay return destination", () => {
    expect(
      replayReturnPath(
        new URLSearchParams({ from: "/routes/route-123" }),
        "route-123",
      ),
    ).toBe("/routes/route-123");
    expect(
      replayReturnPath(
        new URLSearchParams({ from: "/routes/another-route" }),
        "route-123",
      ),
    ).toBeUndefined();
    expect(
      replayReturnPath(
        new URLSearchParams({ from: "https://example.com" }),
        "route-123",
      ),
    ).toBeUndefined();
  });
});
