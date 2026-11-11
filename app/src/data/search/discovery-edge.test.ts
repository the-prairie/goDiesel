import { afterEach, beforeEach, expect, it, vi } from "vitest";

const discover = vi.hoisted(() => vi.fn());
vi.mock("../../../server/discovery", () => ({ discoveryResponse: discover }));
const payload = {
  routes: [{ name: "Forest loop", sourceUrl: "https://www.openstreetmap.org/relation/123", lines: [[[-115.57, 51.17], [-115.56, 51.18]]] }],
  fetchedAt: "2026-10-16T06:00:00.000Z", radiusKm: 18,
};
const request = (query = "lat=51.1784&lng=-115.5708&activity=Run") =>
  new Request(`https://godiesel.pages.dev/api/discovery?${query}`);
const entries = new Map<string, { response: Response; expires: number }>();
const edge = {
  match: vi.fn(async (key: Request) => {
    const entry = entries.get(key.url);
    return entry && entry.expires > Date.now() ? entry.response.clone() : undefined;
  }),
  put: vi.fn(async (key: Request, response: Response) => {
    const ttl = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1]);
    entries.set(key.url, { response: response.clone(), expires: Date.now() + ttl * 1000 });
  }),
};
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); entries.clear();
  vi.setSystemTime(new Date(payload.fetchedAt));
  vi.stubGlobal("caches", { default: edge });
  discover.mockImplementation(async () => Response.json(payload, { headers: { "Cache-Control": "private, max-age=1800" } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function run(input = request()) {
  const pending: Promise<unknown>[] = [];
  const { onRequest } = await import("../../../../functions/api/discovery");
  const response = await onRequest({ request: input, waitUntil: (task: Promise<unknown>) => { pending.push(task); } });
  await Promise.all(pending);
  return response;
}

it("reuses complete route geometry across worker instances while keeping browser responses private", async () => {
  expect(await (await run()).json()).toEqual(payload);
  vi.resetModules();
  discover.mockRejectedValue(new Error("Provider unavailable"));
  const cached = await run(request("activity=Run&lng=-115.570800&lat=51.178400"));
  expect(cached.status).toBe(200);
  expect(await cached.json()).toEqual(payload);
  expect(cached.headers.get("Cache-Control")).toBe("private, max-age=1800");
  expect(discover).toHaveBeenCalledTimes(1);
});

it("refreshes after the existing thirty minute freshness window", async () => {
  await run(); vi.resetModules();
  vi.advanceTimersByTime(1800_000);
  await run();
  expect(discover).toHaveBeenCalledTimes(2);
});

it("does not extend freshness when another worker cache supplies an older result", async () => {
  vi.advanceTimersByTime(1200_000);
  await run();
  expect(edge.put.mock.calls[0][1].headers.get("Cache-Control")).toBe("public, max-age=600");
  expect((await run()).headers.get("Cache-Control")).toBe("private, max-age=600");
  vi.advanceTimersByTime(600_000);
  await run();
  expect(discover).toHaveBeenCalledTimes(2);
  expect(edge.put).toHaveBeenCalledTimes(1);
});

it.each(["invalid", "2026-10-16T05:00:00.000Z"])("does not cache an invalid or expired fetch time %s", async (fetchedAt) => {
  discover.mockImplementation(async () => Response.json({ ...payload, fetchedAt }));
  await run();
  expect(edge.put).not.toHaveBeenCalled();
});

it.each([400, 429, 503])("never caches status %s", async (status) => {
  discover.mockImplementation(async () => Response.json({ error: "Unavailable" }, { status, headers: { "Cache-Control": "no-store" } }));
  expect((await run()).status).toBe(status);
  expect((await run()).status).toBe(status);
  expect(edge.put).not.toHaveBeenCalled();
  expect(discover).toHaveBeenCalledTimes(2);
});

it.each(["place=Banff", "lat=NaN&lng=0", "lat=91&lng=0", "lat=0&lng=181", "lat=0", "lng=0"])("bypasses edge storage for %s", async (query) => {
  await run(request(query));
  expect(edge.match).not.toHaveBeenCalled();
  expect(edge.put).not.toHaveBeenCalled();
});

it("does not serve a GET cache entry for another method or activity", async () => {
  await run();
  await run(new Request(request(), { method: "POST" }));
  await run(request("lat=51.1784&lng=-115.5708&activity=Ride"));
  expect(discover).toHaveBeenCalledTimes(3);
  expect(edge.match).toHaveBeenCalledTimes(2);
});

it("returns provider results when edge reads or writes fail", async () => {
  edge.match.mockRejectedValueOnce(new Error("Cache read failed"));
  edge.put.mockRejectedValueOnce(new Error("Cache write failed"));
  expect(await (await run()).json()).toEqual(payload);
});

it("can cache a genuine empty result", async () => {
  discover.mockImplementation(async () => Response.json({ ...payload, routes: [] }));
  await run(); vi.resetModules();
  expect(await (await run()).json()).toEqual({ ...payload, routes: [] });
  expect(discover).toHaveBeenCalledTimes(1);
});
