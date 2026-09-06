import { describe, expect, it } from "vitest";

import {
  atlasReturnPath,
  designSeedStoryPath,
  isDesignSeedStoryPath,
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

describe("design-seed lab journey", () => {
  it("carries the Atlas URL into the story so the region survives the round trip", () => {
    const atlas = "/lab/design-seeds/b/atlas?region=Crete%2C+Greece&route=14130782031";

    expect(designSeedStoryPath("b", "14130782031", atlas)).toBe(
      `/lab/design-seeds/b/story/14130782031?from=${encodeURIComponent(atlas)}`,
    );
  });

  it("recognises a story path only for its own route", () => {
    expect(isDesignSeedStoryPath("/lab/design-seeds/b/story/14130782031", "14130782031")).toBe(true);
    expect(
      isDesignSeedStoryPath("/lab/design-seeds/b/story/14130782031?from=%2Fx", "14130782031"),
    ).toBe(true);
    expect(isDesignSeedStoryPath("/lab/design-seeds/b/story/other", "14130782031")).toBe(false);
    expect(isDesignSeedStoryPath("/routes/14130782031", "14130782031")).toBe(false);
    expect(isDesignSeedStoryPath("https://example.com", "14130782031")).toBe(false);
  });

  it("lets Replay return to the design-seed story without loosening production rules", () => {
    const story = "/lab/design-seeds/b/story/14130782031";

    expect(replayReturnPath(new URLSearchParams({ from: story }), "14130782031")).toBe(story);
    // A story for a different route is still rejected.
    expect(
      replayReturnPath(
        new URLSearchParams({ from: "/lab/design-seeds/b/story/14080158961" }),
        "14130782031",
      ),
    ).toBeUndefined();
    // Arbitrary lab paths are not return destinations.
    expect(
      replayReturnPath(new URLSearchParams({ from: "/lab/design-system" }), "14130782031"),
    ).toBeUndefined();
    expect(
      replayReturnPath(new URLSearchParams({ from: "/admin" }), "14130782031"),
    ).toBeUndefined();
  });
});
