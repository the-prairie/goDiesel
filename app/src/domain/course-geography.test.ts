import { afterEach, beforeEach, expect, it, vi } from "vitest";

const start = { lat: 0, lng: 0 };
const ring = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
const hole = [[0.002, 0.002], [0.004, 0.002], [0.004, 0.004], [0.002, 0.004], [0.002, 0.002]];
const geometry = (points: number[][]) => points.map(([lon, lat]) => ({ lon, lat }));
const way = (id = 1, tags: Record<string, string> = { leisure: "park" }, points = ring) => ({ type: "way", id, tags, geometry: geometry(points) });
const member = (ref: number, role: string, points: number[][]) => ({ type: "way", ref, role, geometry: geometry(points) });
const relation = (members: unknown[]) => ({ type: "relation", id: 10, tags: { type: "multipolygon", natural: "water" }, members });
const provider = (elements: unknown[] = [], extra = {}) => vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ elements, ...extra }));
const signal = () => new AbortController().signal;
let load: typeof import("../../server/course-geography").loadCourseGeography;
beforeEach(async () => {
  vi.resetModules();
  load = (await import("../../server/course-geography")).loadCourseGeography;
});
afterEach(() => vi.useRealTimers());

it("loads mapped polygons and water lines through one bounded request", async () => {
  const fetcher = provider([way(), way(2, { natural: "water" }), way(3, { waterway: "stream" }, ring.slice(0, 2)), way(4, { natural: "coastline" }, ring.slice(1, 3)), way(5, { leisure: "park", access: "private" })]);
  const result = await load(start, 10_000, signal(), fetcher);
  expect(result).toMatchObject({ status: "available", parks: [{ rings: [ring] }], water: [{ rings: [ring] }], waterways: [ring.slice(0, 2), ring.slice(1, 3)] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const query = new URLSearchParams(String(fetcher.mock.calls[0][1]!.body)).get("data");
  expect(query).toContain("[timeout:6]");
  expect(query).toContain("out geom 2001");
  expect(query).toContain(`(${result.bounds.south},${result.bounds.west},${result.bounds.north},${result.bounds.east})`);
});

it("joins reversed outer and inner ways with holes and suppresses duplicate members", async () => {
  const result = await load(start, 10_000, signal(), provider([
    relation([member(1, "outer", ring.slice(0, 3)), member(2, "outer", ring.slice(2).reverse()), member(3, "inner", hole.slice(0, 3)), member(4, "inner", hole.slice(2).reverse())]),
    way(3, { natural: "water" }, hole),
  ]));
  expect(result.status).toBe("available");
  expect(result.water).toHaveLength(1);
  expect(result.water[0].rings).toHaveLength(2);
  expect(new Set(result.water[0].rings[0].map(String))).toEqual(new Set(ring.map(String)));
  expect(new Set(result.water[0].rings[1].map(String))).toEqual(new Set(hole.map(String)));
});

it("keeps disjoint outer rings as separate polygons", async () => {
  const other = ring.map(([lon, lat]) => [lon + 0.03, lat]);
  const result = await load(start, 10_000, signal(), provider([relation([member(1, "outer", ring), member(2, "outer", other), member(3, "inner", hole)])]));
  expect(result.status).toBe("available");
  expect(result.water.map(polygon => polygon.rings.length).sort()).toEqual([1, 2]);
});

it.each([
  [relation([member(1, "outer", ring.slice(0, 3))])],
  [relation([member(1, "outer", ring), { type: "way", ref: 2, role: "inner" }])],
  [relation([member(1, "outer", ring), member(2, "inner", hole.map(([x, y]) => [x + 1, y]))])],
  [relation([{ type: "relation", ref: 2, role: "outer" }])],
  [way(1, { leisure: "park" }, ring.slice(0, 3))],
  [way(1, { leisure: "park" }, [[0, 0], [1, 0], [2, 0], [0, 0]])],
  [{ ...way(), geometry: [{ lon: 0, lat: 0 }, null] }],
])("marks incomplete or unsupported geometry partial", async element => {
  const result = await load(start, 10_000, signal(), provider([element]));
  expect(result.status).toBe("partial");
  expect(result.parks).toEqual([]);
  expect(result.water).toEqual([]);
});

it("retains usable timeout data but does not cache it", async () => {
  const fetcher = provider([way()], { remark: "runtime error: Query timed out" });
  const result = await load(start, 10_000, signal(), fetcher);
  expect(result.status).toBe("partial");
  expect(result.parks).toHaveLength(1);
  await load(start, 10_000, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  () => Promise.reject(new Error("provider details")),
  async () => new Response("provider details", { status: 503 }),
  async () => new Response("not JSON"),
  async () => Response.json({ bad: true }),
])("returns generic unavailable geography on provider failure", async fetcher => {
  const result = await load(start, 10_000, signal(), fetcher as typeof fetch);
  expect(result).toMatchObject({ status: "unavailable", parks: [], water: [], waterways: [] });
  expect(JSON.stringify(result)).not.toContain("provider details");
});

it("clips dateline and polar bounds without claiming unqueried coverage", async () => {
  const fetcher = provider();
  const east = await load({ lat: 0, lng: 179.99 }, 100_000, signal(), fetcher);
  const west = await load({ lat: 0, lng: -179.99 }, 100_000, signal(), fetcher);
  const pole = await load({ lat: 89.99, lng: 10 }, 100_000, signal(), fetcher);
  expect(east.bounds.east).toBe(180);
  expect(east.bounds.west).toBeCloseTo(179.99 - 12_000 / 111_000);
  expect(west.bounds.west).toBe(-180);
  expect(pole.bounds.north).toBe(90);
  expect(pole.bounds.west).toBeGreaterThanOrEqual(-180);
  expect(pole.bounds.east).toBeLessThanOrEqual(180);
});

it("rejects dateline-crossing rings", async () => {
  const result = await load({ lat: 0, lng: 179.99 }, 10_000, signal(), provider([way(1, { leisure: "park" }, [[179.9, 0], [-179.9, 0], [-179.9, 1], [179.9, 0]])]));
  expect(result.status).toBe("partial");
  expect(result.parks).toEqual([]);
});

it("stops oversized declared and streamed bodies", async () => {
  const declared = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { headers: { "Content-Length": String(4 * 1024 * 1024 + 1) } }));
  expect((await load(start, 10_000, signal(), declared)).status).toBe("unavailable");
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel });
  const streamed = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
  expect((await load(start, 10_000, signal(), streamed)).status).toBe("unavailable");
  expect(cancel).toHaveBeenCalledOnce();
});

it("caps geometry points, relation members, and element counts", async () => {
  const tooManyPoints = Array.from({ length: 2_049 }, (_, i) => [i / 100_000, 0]);
  expect((await load(start, 10_000, signal(), provider([way(1, { leisure: "park" }, tooManyPoints)]))).status).toBe("partial");
  expect((await load(start, 10_000, signal(), provider([relation(Array.from({ length: 257 }, (_, i) => member(i, "outer", ring)))]))).status).toBe("partial");
  const result = await load(start, 10_000, signal(), provider(Array.from({ length: 2_001 }, (_, i) => way(i))));
  expect(result.status).toBe("partial");
  expect(result.parks.length).toBeLessThanOrEqual(2_000);
  const dense = [...Array.from({ length: 1_999 }, (_, i) => [0.01 * Math.cos(i), 0.01 * Math.sin(i)]), [0.01, 0]];
  const limited = await load(start, 10_000, signal(), provider(Array.from({ length: 15 }, (_, i) => way(i, { leisure: "park" }, dense))));
  expect(limited.status).toBe("partial");
  expect(limited.parks.flatMap(polygon => polygon.rings.flat()).length).toBeLessThanOrEqual(20_000);
});

it("aborts after eight seconds even when fetch ignores cancellation", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const pending = load(start, 10_000, signal(), fetcher);
  await vi.advanceTimersByTimeAsync(8_000);
  expect((await pending).status).toBe("unavailable");
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("propagates caller cancellation without sharing it between concurrent lookups", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(() => {})).mockImplementationOnce(async () => Response.json({ elements: [way()] }));
  const first = load(start, 10_000, controller.signal, fetcher);
  const assertion = expect(first).rejects.toBe(reason);
  const second = load(start, 10_000, signal(), fetcher);
  controller.abort(reason);
  await assertion;
  expect((await second).status).toBe("available");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(load(start, 10_000, controller.signal, fetcher)).rejects.toBe(reason);
});

it("cancels a stalled response body", async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const pending = load(start, 10_000, controller.signal, fetcher);
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  controller.abort();
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
});

it("caches at most eight successes for fifteen minutes and isolates returned values", async () => {
  vi.useFakeTimers();
  const fetcher = provider([way()]);
  const first = await load(start, 10_000, signal(), fetcher);
  first.parks.length = 0;
  expect((await load(start, 10_000, signal(), fetcher)).parks).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (let i = 1; i <= 8; i++) await load({ lat: i, lng: 0 }, 10_000, signal(), fetcher);
  await load(start, 10_000, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  await load(start, 10_000, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(11);
});
