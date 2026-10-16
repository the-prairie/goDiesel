import { afterEach, beforeEach, expect, it, vi } from "vitest";
const body = { elements: [{ type: "relation", id: 123, tags: { name: "Forest loop", route: "hiking" }, members: [{ type: "way", ref: 456, geometry: [{ lat: 51.17, lon: -115.57 }, { lat: 51.18, lon: -115.56 }] }] }] };
const request = () => new Request("https://godiesel.pages.dev/api/discovery?lat=51.1784&lng=-115.5708&activity=Run");
let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  upstream = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", upstream);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function run() {
  const { discoveryResponse } = await import("../../../server/discovery");
  const response = discoveryResponse(request());
  await vi.runAllTimersAsync(); return response;
}
it("discovers source geometry from the healthy primary without asking the fallback", async () => {
  upstream.mockImplementation(async (input) =>
    String(input) === "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
      ? Response.json(body)
      : new Response("Busy", { status: 503 }),
  );
  const response = await run();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ routes: [{ name: "Forest loop", sourceUrl: "https://www.openstreetmap.org/relation/123", lines: [[[-115.57, 51.17], [-115.56, 51.18]]] }] });
  expect(upstream).toHaveBeenCalledTimes(1);
});
it("fails over once from an overloaded provider, preserving source geometry and caching success", async () => {
  upstream.mockResolvedValueOnce(new Response("Busy", { status: 502 })).mockResolvedValueOnce(Response.json(body));
  const response = await run();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ routes: [{ name: "Forest loop", sourceUrl: "https://www.openstreetmap.org/relation/123", lines: [[[-115.57, 51.17], [-115.56, 51.18]]] }] });
  expect(upstream.mock.calls.map(call => call[0])).toEqual(["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"]);
  const { discoveryResponse } = await import("../../../server/discovery");
  expect((await discoveryResponse(request())).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("does not retry permanent request errors", async () => {
  upstream.mockResolvedValueOnce(new Response("Bad query", { status: 400 }));
  expect((await run()).status).toBe(503); expect(upstream).toHaveBeenCalledTimes(1);
});
it("stops after two unavailable providers and returns a retry hint, not empty results", async () => {
  upstream.mockImplementation(async () => new Response("Busy", { status: 503 }));
  const response = await run();
  expect(response.status).toBe(503); expect(response.headers.get("Retry-After")).toBe("60");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ code: "http", error: expect.stringContaining("try again in a minute") });
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("recovers from a transport error", async () => {
  upstream.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(Response.json(body));
  expect((await run()).status).toBe(200);
});
it("rejects partial Overpass output even when it contains routes", async () => {
  upstream.mockResolvedValueOnce(Response.json({ ...body, remark: "runtime error: Query timed out" })).mockResolvedValueOnce(Response.json(body));
  expect((await run()).status).toBe(200); expect(upstream).toHaveBeenCalledTimes(2);
});
it("rejects malformed success instead of reporting no matches", async () => {
  upstream.mockResolvedValueOnce(Response.json({}));
  const response = await run(); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "invalid-response" });
  expect(upstream).toHaveBeenCalledTimes(1);
});

it("recovers when a successful response stream fails during download", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } });
  upstream.mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(Response.json(body));
  expect((await run()).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});

it("preserves a retryable HTTP status when cancelling its failed body", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } });
  upstream.mockResolvedValueOnce(new Response(stream, { status: 502 })).mockResolvedValueOnce(Response.json(body));
  expect((await run()).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("accepts a genuine empty result without asking the fallback", async () => {
  upstream.mockResolvedValueOnce(Response.json({ elements: [] }));
  const response = await run();
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ routes: [] });
  expect(upstream).toHaveBeenCalledTimes(1);
});
