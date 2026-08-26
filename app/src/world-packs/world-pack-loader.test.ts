import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorldPackForRoute, WorldPackLoadError } from "@/world-packs/world-pack-loader";
import type { WorldPackLoadPhase } from "@/world-packs/world-pack-types";

const PUBLIC_ROOT = path.resolve(import.meta.dirname, "../../public");
const BASE_HREF = "https://godiesel.test/";

function body(bytes: Uint8Array): ArrayBuffer {
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result.buffer;
}

function fileFetcher(tamperPath?: string): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://godiesel.test") {
      return new Response("cross-origin request", { status: 502 });
    }
    try {
      const bytes = new Uint8Array(
        await fs.readFile(path.join(PUBLIC_ROOT, url.pathname)),
      );
      if (url.pathname === tamperPath) bytes[bytes.length - 1] ^= 1;
      return new Response(body(bytes), {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
      });
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
}

describe("World Pack browser loader", () => {
  for (const routeSlug of ["17665674778", "15573295095", "6496900063"]) {
    it(`verifies the complete physical neighbourhood for ${routeSlug}`, async () => {
      const phases: WorldPackLoadPhase[] = [];
      const pack = await loadWorldPackForRoute(routeSlug, {
        baseHref: BASE_HREF,
        fetcher: fileFetcher(),
        onPhase: (phase) => phases.push(phase),
      });

      expect(pack.manifest.routeId).toBe(routeSlug);
      expect(pack.runtime.coordinateReference).toBe("route-local-enu-v1");
      expect(pack.runtime.modes).toEqual(["guided", "free-roam"]);
      expect(pack.navigation.fixedTimestepHz).toBe(60);
      expect(pack.navigation.nodes.length).toBe(
        pack.canonicalRoute.coordinates.length,
      );
      expect(pack.artifacts.size).toBeGreaterThanOrEqual(12);
      expect(phases).toEqual([
        "index",
        "manifest",
        "integrity",
        "physical-neighbourhood",
        "ready",
      ]);
    });
  }

  it("rejects one altered byte before declaring the world ready", async () => {
    const index = JSON.parse(
      await fs.readFile(path.join(PUBLIC_ROOT, "world-packs/index.json"), "utf8"),
    );
    const basePath = index.packs["17665674778"].basePath;
    const tamperPath = `${basePath}physics/terrain-collision.glb`;

    await expect(
      loadWorldPackForRoute("17665674778", {
        baseHref: BASE_HREF,
        fetcher: fileFetcher(tamperPath),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorldPackLoadError>>({
        code: "integrity",
        message: expect.stringContaining("SHA-256 mismatch"),
      }),
    );
  });

  it("rejects unpublished routes without falling back to a live provider", async () => {
    await expect(
      loadWorldPackForRoute("not-published", {
        baseHref: BASE_HREF,
        fetcher: fileFetcher(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorldPackLoadError>>({
        code: "unavailable",
        message: expect.stringContaining("No local World Pack"),
      }),
    );
  });
});
