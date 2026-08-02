import routeJson from "../../../public/data/routes/14023448720.json";
import { describe, expect, it } from "vitest";

import { parseRouteDetail } from "@/domain/routes";
import {
  createPortableRouteFilmManifest,
  ROUTE_FILM_MANIFEST_CONTRACT,
} from "@/replay/film/portable-route-film-manifest";

describe("createPortableRouteFilmManifest", () => {
  const route = parseRouteDetail(routeJson);

  it("creates a renderer-neutral 4K route film contract", () => {
    const manifest = createPortableRouteFilmManifest(route);

    expect(manifest.contract).toBe(ROUTE_FILM_MANIFEST_CONTRACT);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.render).toMatchObject({
      fps: 24,
      height: 2160,
      width: 3840,
      tileReadiness: {
        incompleteFramesAllowed: 0,
        strategy: "camera-cut-prestream-and-block",
      },
    });
    expect(manifest.render.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(manifest.render.durationSeconds).toBeLessThanOrEqual(24);
    expect(manifest.route.points).toHaveLength(route.route.length);
    expect(manifest.camera.keyframes.at(0)?.frame).toBe(0);
    expect(manifest.camera.keyframes.at(-1)?.frame).toBe(
      manifest.render.frameCount - 1,
    );
    expect(manifest.camera.keyframes[0].eye.heightM).toBeGreaterThan(
      manifest.camera.keyframes[0].target.heightM,
    );
    expect(manifest.comparison.frames).toHaveLength(5);
  });

  it("is deterministic for identical route and render settings", () => {
    expect(createPortableRouteFilmManifest(route)).toEqual(
      createPortableRouteFilmManifest(route),
    );
  });

  it("honors a bounded proof duration and keyframe cadence", () => {
    const manifest = createPortableRouteFilmManifest(route, {
      durationSeconds: 20,
      fps: 30,
      keyframeIntervalFrames: 30,
    });

    expect(manifest.render.durationSeconds).toBe(20);
    expect(manifest.render.frameCount).toBe(601);
    expect(manifest.camera.keyframes.map((frame) => frame.frame)).toEqual([
      0,
      30,
      60,
      90,
      120,
      150,
      180,
      210,
      240,
      270,
      300,
      330,
      360,
      390,
      420,
      450,
      480,
      510,
      540,
      570,
      600,
    ]);
  });
});
