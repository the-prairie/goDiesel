import { describe, expect, it, vi } from "vitest";
import { generateOrsCourse, orsProfile, parseOrsCandidate } from "../../server/ors";
import { coursesResponse, type CourseStore } from "../../server/courses";
import { courseGpx, parseCourse, parseCourseRequest, type Course, type CourseRequest } from "./courses";

const request: CourseRequest = { start: { lat: 0, lng: 0, name: "Test park" }, distance: 2, unit: "km", activity: "Run", vibes: ["paved"], hills: "less", seed: 0 };
function provider(variation = 0, surface = 3) {
  const d = .0045 + variation * .0001;
  return { features: [{ geometry: { type: "LineString", coordinates: [[0, 0, 0], [d, 0, 2], [d, d, 3], [0, d, 1], [0, 0, 0]] }, properties: { extras: { surface: { values: [[0, 4, surface]] }, waytype: { values: [[0, 4, 7]] } } } }] };
}
function network(responses: Array<Response | Error>) {
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    init?.signal?.throwIfAborted();
    if (init?.redirect === "error") throw new TypeError("Workers do not support redirect:error");
    if (String(url).includes("overpass")) return Response.json({ elements: [] });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result ?? new Response(null, { status: 500 });
  });
}

describe("ORS boundary", () => {
  it("maps foot, general cycling, and paved cycling without promising a running profile", () => {
    expect(orsProfile(request)).toBe("foot-walking");
    expect(orsProfile({ ...request, activity: "Ride", vibes: [] })).toBe("cycling-regular");
    expect(orsProfile({ ...request, activity: "Ride" })).toBe("cycling-road");
  });
  it("validates hills and retains old requests without adding a field", () => {
    expect(parseCourseRequest(request).hills).toBe("less");
    expect(() => parseCourseRequest({ ...request, hills: "flat" })).toThrow();
    const { hills: _, ...old } = request;
    expect(parseCourseRequest(old)).not.toHaveProperty("hills");
  });
  it("makes unsupported and malformed extra info unknown", () => {
    expect(parseOrsCandidate(provider(0, 1234), request.start).surface[0].kind).toBe("unknown");
    const value = provider();
    value.features[0].properties.extras.surface.values = [[0, 2, 3], [1, 4, 3]];
    expect(parseOrsCandidate(value, request.start).surface).toEqual([]);
  });
  it("rejects disconnected loops and invalid elevation", () => {
    const value = provider();
    value.features[0].geometry.coordinates[2][0] = 100;
    expect(() => parseOrsCandidate(value, request.start)).toThrow(/connected/);
    value.features[0].geometry.coordinates[2][2] = NaN;
    expect(() => parseOrsCandidate(value, request.start)).toThrow(/coordinates/);
  });
  it("bounds routing to two attempts and preserves evidence through save and GPX export", async () => {
    const fetcher = network([Response.json(provider()), Response.json(provider(1, 10))]);
    const saved = new Map<string, Course>();
    const store: CourseStore = { list: async () => ({ courses: [] }), get: async (id) => saved.get(id) ?? null, put: async (course) => { saved.set(course.id, course); return { course, created: true }; } };
    const options = { store, localDevelopment: true, orsApiKey: "private-test-key", fetch: fetcher };
    const post = (body: unknown) => coursesResponse(new Request("http://localhost/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), options);
    const generated = await post({ action: "generate", request });
    expect(generated.status).toBe(200);
    const result = await generated.json();
    expect(result.course.source.provider).toBe("ors");
    expect(result.course.assessment.selection.comparedCount).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("directions"))).toHaveLength(2);
    const response = await post({ action: "save", ...result });
    expect(response.status).toBe(201);
    const course = parseCourse((await response.json()).course);
    expect(course.assessment).toEqual(result.course.assessment);
    expect(courseGpx(course)).toContain("openrouteservice.org");
    expect(courseGpx(course)).toContain("CC BY-SA");
    const tampered = structuredClone(result);
    tampered.course.assessment.paved.matchedM = 0;
    tampered.course.assessment.paved.share = 0;
    expect((await post({ action: "save", ...tampered })).status).toBe(400);
  });
  it("returns a usable result honestly when its alternative fails", async () => {
    const course = await generateOrsCourse(request, "key", new AbortController().signal, network([Response.json(provider()), new DOMException("timeout", "TimeoutError")]));
    expect(course.assessment?.selection?.comparedCount).toBe(1);
    expect(course.warnings.join(" ")).toContain("Only one of two");
  });
  it("fails clearly on quota exhaustion without retries", async () => {
    const fetcher = network([new Response(null, { status: 429 }), new Response(null, { status: 429 })]);
    await expect(generateOrsCourse(request, "key", new AbortController().signal, fetcher)).rejects.toMatchObject({ status: 429 });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("directions"))).toHaveLength(2);
  });
  it("does not call providers for oversized loops", async () => {
    const fetcher = network([]);
    await expect(generateOrsCourse({ ...request, distance: 101 }, "key", new AbortController().signal, fetcher)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("propagates cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateOrsCourse(request, "key", controller.signal, network([]))).rejects.toMatchObject({ name: "AbortError" });
  });
});
