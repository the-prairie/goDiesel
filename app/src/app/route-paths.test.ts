import { describe, expect, it } from "vitest";

import { atlasReturnPath, sketchRealmPath, sketchWorldPath, overlandEntryPath, overlandRealmPath, overlandTownPath, overlandTownRealmPath, overlandWorldPath, replayPath } from "@/app/route-paths";

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

describe("Overland lab paths", () => {
  it("opens the world, with an optional town and view", () => {
    expect(overlandWorldPath()).toBe("/lab/overland");
    expect(overlandWorldPath({ town: "Kyoto, Japan", view: "index" })).toBe(
      "/lab/overland?town=Kyoto%2C+Japan&view=index",
    );
    expect(overlandWorldPath({ view: "map" })).toBe("/lab/overland");
  });

  it("opens one route's entry by slug", () => {
    expect(overlandEntryPath("17636880071")).toBe("/lab/overland/17636880071");
    expect(overlandEntryPath("a b")).toBe("/lab/overland/a%20b");
  });

  it("opens one route's 3D world below its entry, with a jump transition only when asked", () => {
    expect(overlandRealmPath("17636880071")).toBe("/lab/overland/17636880071/3d");
    expect(overlandRealmPath("a b", "live")).toBe("/lab/overland/a%20b/3d?jump=live");
    expect(overlandRealmPath("a b", "wipe")).toBe("/lab/overland/a%20b/3d");
  });

  it("opens a town in 3D, optionally at one signpost, and a route's 3D world from it", () => {
    expect(overlandTownPath("kyoto-japan")).toBe("/lab/overland/town/kyoto-japan");
    expect(overlandTownPath("kyoto-japan", "17636880071")).toBe("/lab/overland/town/kyoto-japan?sign=17636880071");
    expect(overlandTownRealmPath("kyoto-japan", "a b")).toBe("/lab/overland/town/kyoto-japan/a%20b/3d");
  });
});

describe("sketch world paths", () => {
  it("keeps the review options and the chosen route in the world's URL", () => {
    expect(sketchWorldPath()).toBe("/lab/sketch");
    expect(sketchWorldPath("review=1&look=pencil")).toBe("/lab/sketch?review=1&look=pencil");
  });

  it("opens a route's 3D world below the sketch, keeping the options", () => {
    expect(sketchRealmPath("a b", "review=1")).toBe("/lab/sketch/a%20b/3d?review=1");
    expect(sketchRealmPath("x")).toBe("/lab/sketch/x/3d");
  });
});
