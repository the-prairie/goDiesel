import { describe, expect, it } from "vitest";

import {
  downsampleThumbnailPath,
  nextThumbnailState,
  routeSatelliteThumbnailUrl,
} from "@/surfaces/atlas/components/route-satellite-thumbnail";
import type { RoutePoint } from "@/domain/route";

function routePoint(index: number): RoutePoint {
  return {
    lat: 35 + index / 1_000,
    lng: 135 + index / 1_000,
    elev: index,
    d: index * 10,
  };
}

describe("route satellite thumbnail adapter", () => {
  it("derives a bounded path from recorded geometry and preserves endpoints", () => {
    const source = Array.from({ length: 200 }, (_, index) => routePoint(index));
    const sampled = downsampleThumbnailPath(source);

    expect(sampled).toHaveLength(36);
    expect(sampled[0]).toEqual(source[0]);
    expect(sampled.at(-1)).toEqual(source.at(-1));
  });

  it("builds a static satellite request with the downsampled recorded path", () => {
    const url = routeSatelliteThumbnailUrl(
      Array.from({ length: 80 }, (_, index) => routePoint(index)),
      "test-key",
    );
    const parsed = new URL(url!);
    const path = parsed.searchParams.get("path")!;

    expect(parsed.origin).toBe("https://maps.googleapis.com");
    expect(parsed.pathname).toBe("/maps/api/staticmap");
    expect(parsed.searchParams.get("maptype")).toBe("satellite");
    expect(parsed.searchParams.get("key")).toBe("test-key");
    expect(path.split("|").slice(2)).toHaveLength(36);
    expect(url!.length).toBeLessThan(8_192);
  });

  it("does not request imagery without a credential or usable geometry", () => {
    expect(routeSatelliteThumbnailUrl([routePoint(0), routePoint(1)], "")).toBeNull();
    expect(routeSatelliteThumbnailUrl([routePoint(0)], "test-key")).toBeNull();
  });

  it("retains completed thumbnails when they leave the request window", () => {
    expect(nextThumbnailState("loaded", false, "https://example.test/map.png")).toBe(
      "loaded",
    );
    expect(nextThumbnailState("failed", false, "https://example.test/map.png")).toBe(
      "failed",
    );
  });

  it("defers unfinished thumbnails outside the request window", () => {
    expect(nextThumbnailState("loading", false, "https://example.test/map.png")).toBe(
      "deferred",
    );
    expect(nextThumbnailState("deferred", true, "https://example.test/map.png")).toBe(
      "loading",
    );
  });
});
