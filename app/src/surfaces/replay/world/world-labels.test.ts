import { afterEach, describe, expect, it, vi } from "vitest";
import { MVTOverlay, PMTilesOverlay } from "3d-tiles-renderer/three/plugins";
import { resolveVectorSource } from "./world-labels";

afterEach(() => vi.unstubAllGlobals());

describe("Pinned MVT source ownership", () => {
  it.each([MVTOverlay, PMTilesOverlay])("releases the actual image-source cache, not a nonexistent overlay method", (Overlay) => {
    const overlay = new Overlay({ url: "https://example.com/tiles.pmtiles" });
    expect(typeof overlay.imageSource.dispose).toBe("function");
    expect(() => overlay.imageSource.dispose()).not.toThrow();
  });
  it("resolves current TileJSON rather than embedding a dated tile URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tiles: ["/current/{z}/{x}/{y}.pbf"], maxzoom: 20 })));
    vi.stubGlobal("fetch", fetcher);
    const source = await resolveVectorSource("https://example.com/planet", new AbortController().signal);
    expect(source).toEqual({ url: "https://example.com/current/{z}/{x}/{y}.pbf", maxzoom: 16, pmtiles: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("accepts explicit templates and PMTiles without a metadata request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await resolveVectorSource("https://example.com/{z}/{x}/{y}.pbf", new AbortController().signal)).pmtiles).toBe(false);
    expect((await resolveVectorSource("https://example.com/map.pmtiles", new AbortController().signal)).pmtiles).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects insecure source metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ tiles: ["http://example.com/{z}/{x}/{y}.pbf"] }))));
    await expect(resolveVectorSource("https://example.com/planet", new AbortController().signal)).rejects.toThrow("HTTPS");
  });
});
