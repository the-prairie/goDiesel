import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  coursesResponse,
  brouterRequest,
  type CourseStore,
} from "../../server/courses";
import {
  coursesPlugin,
  defaultCourseStoreDirectory,
  FileCourseStore,
} from "../../server/courses-plugin";
import { onRequest, R2CourseStore } from "../../../functions/api/courses";
import {
  COURSE_PAGE_SIZE,
  courseCursor,
  courseSummary,
  importCourseGpx,
  parseCourseCursor,
  type Course,
  type CourseRequest,
} from "./courses";

it("loads in a Workers global scope where random generation is forbidden", async () => {
  vi.resetModules();
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
    throw new Error("Random generation is only allowed in a request handler");
  });
  try {
    await expect(import("../../server/courses")).resolves.toBeDefined();
  } finally {
    random.mockRestore();
  }
});

const request: CourseRequest = {
  start: { lat: 0, lng: 0, name: "Town" },
  distance: 2,
  unit: "km",
  activity: "Run",
  vibes: ["quiet", "green"],
  seed: 12,
};
const coordinates = [
  [0, 0, 10],
  [0.0045, 0, 11],
  [0.0045, 0.0045, 12],
  [0, 0.0045, 13],
  [0, 0, 10],
];
const provider = (points = coordinates) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { "total-time": 900, "track-length": 99999 },
      geometry: { type: "LineString", coordinates: points },
    },
  ],
});
const gpx =
  '<gpx version="1.1"><trk><name>My run</name><trkseg><trkpt lat="0" lon="0"><ele>1</ele></trkpt><trkpt lat="0" lon="0.004"><ele>2</ele></trkpt></trkseg></trk></gpx>';
function store(): CourseStore {
  const courses = new Map<string, Course>();
  return {
    list: async (after) => {
      const remaining = [...courses.values()]
        .filter((course) => !after || course.id > after)
        .sort((a, b) => a.id.localeCompare(b.id));
      const page = remaining.slice(0, COURSE_PAGE_SIZE).map(courseSummary);
      return {
        courses: page,
        ...(remaining.length > COURSE_PAGE_SIZE
          ? { cursor: courseCursor(page.at(-1)!.id) }
          : {}),
      };
    },
    get: async (id) => courses.get(id) ?? null,
    put: async (course) => {
      const existing = courses.get(course.id);
      if (existing) return { course: existing, created: false };
      courses.set(course.id, course);
      return { course, created: true };
    },
  };
}
function post(
  body: unknown,
  headers: Record<string, string> = {},
  base = "http://localhost",
) {
  return new Request(`${base}/api/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("course HTTP boundary", () => {
  it("fails closed outside loopback and without production storage or authentication", async () => {
    for (const options of [
      {},
      { store: store() },
      { token: "secret" },
      { localDevelopment: true, store: store() },
    ]) {
      const response = await coursesResponse(
        new Request("https://example.com/api/courses"),
        options,
      );
      expect(response.status).toBe(503);
    }
    const response = await onRequest({
      request: new Request("https://example.com/api/courses"),
      env: {},
    });
    expect(response.status).toBe(503);
  });

  it("requires configured owner tokens, blocks cross-origin writes, and never returns CORS wildcard", async () => {
    const options = { store: store(), token: "secret", localDevelopment: true };
    expect(
      (
        await coursesResponse(
          new Request("http://localhost/api/courses"),
          options,
        )
      ).status,
    ).toBe(401);
    const response = await coursesResponse(
      post(
        { action: "import", gpx, filename: "a.gpx", activity: "Run" },
        { Authorization: "Bearer secret", Origin: "https://evil.example" },
      ),
      options,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(
      (
        await coursesResponse(
          new Request("http://localhost/api/courses", {
            headers: { Authorization: "Bearer secret" },
          }),
          options,
        )
      ).status,
    ).toBe(200);
  });

  it("previews imports without writing and saves/reopens/exports idempotently", async () => {
    const options = { store: store(), localDevelopment: true };
    const imported = await coursesResponse(
      post({ action: "import", gpx, filename: "a.gpx", activity: "Run" }),
      options,
    );
    expect(imported.status).toBe(200);
    const { course } = await imported.json();
    expect((await options.store.list()).courses).toHaveLength(0);
    const again = await (
      await coursesResponse(
        post({ action: "import", gpx, filename: "a.gpx", activity: "Run" }),
        options,
      )
    ).json();
    expect(again.course.id).toBe(course.id);
    expect(
      (await coursesResponse(post({ action: "save", course }), options)).status,
    ).toBe(201);
    expect(
      (await coursesResponse(post({ action: "save", course }), options)).status,
    ).toBe(200);
    expect((await options.store.list()).courses).toHaveLength(1);
    const reopened = await coursesResponse(
      new Request(`http://localhost/api/courses?id=${course.id}`),
      options,
    );
    expect((await reopened.json()).course.name).toBe("My run");
    const exported = await coursesResponse(
      new Request(`http://localhost/api/courses?id=${course.id}&format=gpx`),
      options,
    );
    expect(exported.headers.get("Content-Type")).toContain(
      "application/gpx+xml",
    );
    expect(await exported.text()).toContain("<trkpt");
  });

  it("rejects oversized bodies, invalid actions, invalid IDs and malicious XML", async () => {
    const options = { store: store(), localDevelopment: true };
    expect(
      (
        await coursesResponse(
          post({}, { "Content-Length": String(6 * 1024 * 1024) }),
          options,
        )
      ).status,
    ).toBe(413);
    expect(
      (await coursesResponse(post({ action: "delete" }), options)).status,
    ).toBe(400);
    expect(
      (
        await coursesResponse(
          new Request("http://localhost/api/courses?id=../../private"),
          options,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await coursesResponse(
          post({
            action: "import",
            filename: "a.gpx",
            activity: "Run",
            gpx: '<!DOCTYPE gpx [<!ENTITY secret SYSTEM "file:///etc/passwd">]><gpx>&secret;</gpx>',
          }),
          options,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await coursesResponse(
          new Request("http://localhost/api/courses", { method: "DELETE" }),
          options,
        )
      ).status,
    ).toBe(405);
  });

  it("keeps storage/provider exception details out of HTTP errors", async () => {
    const broken: CourseStore = {
      ...store(),
      list: async () => {
        throw new Error("secret/token/private-path");
      },
    };
    const response = await coursesResponse(
      new Request("http://localhost/api/courses"),
      { store: broken, localDevelopment: true },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});

describe("course collection HTTP boundary", () => {
  it("rejects malformed cursors without querying storage", async () => {
    const list = vi.fn();
    for (const cursor of ["", "../private", "x".repeat(72), "x".repeat(4096)]) {
      const response = await coursesResponse(
        new Request(
          `http://localhost/api/courses?cursor=${encodeURIComponent(cursor)}`,
        ),
        {
          store: { ...store(), list },
          localDevelopment: true,
        },
      );
      expect(response.status).toBe(400);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("saves the maximum point count within the existing body limit and omits its geometry from lists", async () => {
    const course = {
      id: "course-11111111-1111-5111-8111-111111111111",
      name: "Maximum course",
      description: "",
      activity: "Run",
      createdAt: "2026-10-21T00:00:00Z",
      source: { kind: "gpx", filename: "capacity.gpx" },
      warnings: [],
      segments: [
        Array.from({ length: 50_000 }, (_, index) => ({
          lat: 51 + index * 0.000001,
          lng: -114,
          elevationM: 1000 + (index % 20),
          time: "2026-10-21T00:00:00Z",
        })),
      ],
    };
    const body = { action: "save", course };
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeLessThan(5 * 1024 * 1024);
    const options = { store: store(), localDevelopment: true };
    const response = await coursesResponse(post(body), options);
    expect(response.status).toBe(201);
    const saved = (await response.json()).course;
    const reopened = await coursesResponse(
      new Request(`http://localhost/api/courses?id=${saved.id}`),
      options,
    );
    expect((await reopened.json()).course.segments).toEqual(course.segments);
    const listed = await coursesResponse(
      new Request("http://localhost/api/courses"),
      options,
    );
    expect(await listed.json()).toEqual({ courses: [courseSummary(saved)] });
  });

  it("returns summaries while detail remains available independently of list failure", async () => {
    const options = { store: store(), localDevelopment: true };
    const imported = await (
      await coursesResponse(
        post({ action: "import", gpx, filename: "a.gpx", activity: "Run" }),
        options,
      )
    ).json();
    const saved = await (
      await coursesResponse(
        post({ action: "save", course: imported.course }),
        options,
      )
    ).json();
    const page = await (
      await coursesResponse(
        new Request("http://localhost/api/courses"),
        options,
      )
    ).json();
    expect(page).toEqual({ courses: [courseSummary(saved.course)] });
    const response = await coursesResponse(
      new Request(`http://localhost/api/courses?id=${saved.course.id}`),
      {
        ...options,
        store: {
          ...options.store,
          list: async () => {
            throw new Error("List failed");
          },
        },
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).course.segments).toEqual(
      saved.course.segments,
    );
  });
});

describe("bounded route generation", () => {
  it.each(["Run", "Walk", "Ride"] as const)(
    "generates %s from real provider geometry without invented timing",
    async (activity) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(provider())));
      const response = await coursesResponse(
        post({ action: "generate", request: { ...request, activity } }),
        { store: store(), localDevelopment: true, fetch },
      );
      expect(response.status).toBe(200);
      const { course } = await response.json();
      expect(course.distanceM).toBeGreaterThan(1900);
      expect(course.distanceM).toBeLessThan(2100);
      expect(course.segments[0][0]).toEqual({ lng: 0, lat: 0, elevationM: 10 });
      expect(
        course.segments[0].some(
          (point: Record<string, unknown>) => "time" in point,
        ),
      ).toBe(false);
      expect(course.source.profile).toBe(
        activity === "Ride" ? "trekking" : "hiking-mountain",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("uses supported profile preferences and blocks demanding hiking by default", () => {
    const url = brouterRequest(
      { ...request, vibes: ["quiet", "water", "green", "paved"] },
      "https://router.example/brouter",
      400,
      20,
    );
    expect(url.searchParams.get("profile:consider_noise")).toBe("1");
    expect(url.searchParams.get("profile:consider_forest")).toBe("1");
    expect(url.searchParams.get("profile:consider_river")).toBe("1");
    expect(url.searchParams.get("profile:SAC_scale_limit")).toBe("1");
    expect(url.searchParams.get("profile:add_beeline")).toBe("0");
    const pavedCycling = brouterRequest(
      { ...request, activity: "Ride", vibes: ["paved"] },
      "https://router.example/brouter",
      400,
      20,
    );
    expect(pavedCycling.searchParams.get("profile")).toBe("fastbike");
    expect(pavedCycling.searchParams.has("profile:unpavedPenalty")).toBe(false);
  });

  it("keeps generated names short without losing the original place", async () => {
    const start = {
      ...request.start,
      name: "Golden Gate Park, San Francisco, California, United States",
    };
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(provider())));
    const response = await coursesResponse(
      post({ action: "generate", request: { ...request, start } }),
      { store: store(), localDevelopment: true, fetch },
    );
    const { course } = await response.json();
    expect(course.name).toBe("Golden Gate Park run loop");
    expect(course.source.request.start.name).toBe(start.name);
    const long = await coursesResponse(
      post({
        action: "generate",
        request: { ...request, start: { ...start, name: "a".repeat(200) } },
      }),
      { store: store(), localDevelopment: true, fetch },
    );
    expect(long.status).toBe(200);
    expect((await long.json()).course.name.length).toBeLessThanOrEqual(200);
  });

  it("requires a genuine receipt before saving provider provenance", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(provider())));
    const options = { store: store(), localDevelopment: true, fetch };
    const { course, receipt } = await (
      await coursesResponse(post({ action: "generate", request }), options)
    ).json();
    expect(
      (await coursesResponse(post({ action: "save", course }), options)).status,
    ).toBe(400);
    expect(
      (
        await coursesResponse(
          post({ action: "save", course, receipt: "x".repeat(43) }),
          options,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await coursesResponse(
          post({
            action: "save",
            course: { ...course, name: "Tampered" },
            receipt,
          }),
          options,
        )
      ).status,
    ).toBe(400);
    expect((await options.store.list()).courses).toHaveLength(0);
    expect(
      (
        await coursesResponse(
          post({ action: "save", course, receipt }),
          options,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await coursesResponse(
          post({ action: "save", course, receipt }),
          options,
        )
      ).status,
    ).toBe(200);
  });

  it("requires a separate server-only production signing key", async () => {
    const fetch = vi.fn();
    const response = await coursesResponse(
      post(
        { action: "generate", request },
        { Authorization: "Bearer owner-token" },
        "https://app.example",
      ),
      {
        store: store(),
        token: "owner-token",
        routerUrl: "https://routing.example/brouter",
        fetch,
      },
    );
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds attempts and refuses a route farther than 30 percent from target", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(provider())));
    const response = await coursesResponse(
      post({ action: "generate", request: { ...request, distance: 10 } }),
      { store: store(), localDevelopment: true, fetch },
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("2.0 km");
  });

  it("labels achieved distance outside 10 percent and discloses unsupported foot paving", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(provider())));
    const response = await coursesResponse(
      post({
        action: "generate",
        request: { ...request, distance: 2.5, vibes: ["paved"] },
      }),
      { store: store(), localDevelopment: true, fetch },
    );
    const { course } = await response.json();
    expect(course.warnings.join(" ")).toContain("shorter");
    expect(course.warnings.join(" ")).toContain("cannot enforce paved");
  });

  it("rejects open geometry and routes snapped far from the start", async () => {
    for (const points of [
      coordinates.slice(0, -1),
      coordinates.map(([lng, lat, elevation]) => [lng + 1, lat, elevation]),
    ]) {
      const fetch = vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify(provider(points))),
        );
      const response = await coursesResponse(
        post({ action: "generate", request }),
        { store: store(), localDevelopment: true, fetch },
      );
      expect(response.status).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(3);
    }
  });

  it("does not use the public routing service in production", async () => {
    const fetch = vi.fn();
    const response = await coursesResponse(
      post(
        { action: "generate", request },
        { Authorization: "Bearer secret" },
        "https://app.example",
      ),
      { store: store(), token: "secret", fetch },
    );
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancellation prevents requests and saving", async () => {
    const fetch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const input = post({ action: "generate", request });
    const response = await coursesResponse(
      new Request(input, { signal: controller.signal }),
      { store: store(), localDevelopment: true, fetch },
    );
    expect(response.status).toBe(408);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("course persistence adapters", () => {
  it("keeps private course files inaccessible through Vite URLs", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "godiesel-private-courses-"),
    );
    temporary.push(directory);
    const root = path.join(directory, "site");
    const privateDirectory = path.join(directory, "private");
    await mkdir(path.join(root, ".local", "courses"), { recursive: true });
    await mkdir(privateDirectory);
    await writeFile(
      path.join(root, ".local", "courses", "old.json"),
      "private-legacy-data",
    );
    await writeFile(
      path.join(privateDirectory, "private.json"),
      "private-course-data",
    );
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [
        coursesPlugin({
          token: "owner-secret",
          storeDirectory: privateDirectory,
        }),
      ],
      server: { host: "127.0.0.1", port: 0, fs: { allow: [directory] } },
    });
    try {
      await server.listen();
      const address = server.httpServer!.address() as { port: number };
      const base = `http://127.0.0.1:${address.port}`;
      for (const location of [
        "/.local/courses/old.json",
        "/%2elocal/courses/old.json?raw",
        `/@fs/${privateDirectory}/private.json`,
        `/@fs/${privateDirectory}/private.json?raw`,
      ]) {
        const response = await fetch(base + location);
        expect(response.status, location).toBe(404);
        expect(await response.text()).not.toContain("private-");
      }
      expect((await fetch(`${base}/api/courses`)).status).toBe(401);
      expect(defaultCourseStoreDirectory(root).startsWith(root)).toBe(false);
    } finally {
      await server.close();
    }
    await expect(
      createServer({
        configFile: false,
        root,
        plugins: [
          coursesPlugin({ storeDirectory: path.join(root, "private") }),
        ],
      }),
    ).rejects.toThrow("outside the Vite served root");
  });

  it("reopens a course from a fresh filesystem store", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "godiesel-courses-"));
    temporary.push(directory);
    const course = importCourseGpx(gpx, {
      id: "course-11111111-1111-5111-8111-111111111111",
      createdAt: "2026-10-21T00:00:00Z",
      filename: "route.gpx",
      activity: "Walk",
    });
    await new FileCourseStore(directory).put(course);
    const reopened = await new FileCourseStore(directory).get(course.id);
    expect(reopened?.segments).toEqual(course.segments);
    expect((await new FileCourseStore(directory).list()).courses).toHaveLength(
      1,
    );
    await expect(
      new FileCourseStore(directory).get("../secret"),
    ).rejects.toThrow();
  });

  it("lists R2 metadata in bounded pages without reading any course body", async () => {
    const fixture = importCourseGpx(gpx, {
      id: "course-11111111-1111-5111-8111-111111111111",
      createdAt: "2026-10-21T00:00:00Z",
      filename: "route.gpx",
      activity: "Walk",
    });
    const courses = Array.from({ length: 30 }, (_, index) => ({
      ...fixture,
      id: `course-${String(index).padStart(8, "0")}-1111-5111-8111-111111111111`,
    }));
    const bucket = {
      get: async () => {
        throw new Error("Course bodies are unavailable");
      },
      put: async () => null,
      list: async ({
        startAfter,
        limit,
      }: {
        startAfter?: string;
        limit: number;
      }) => {
        const remaining = courses.filter(
          (course) => !startAfter || course.id > startAfter,
        );
        return {
          objects: remaining
            .slice(0, limit)
            .map((course) => ({
              key: course.id,
              customMetadata: {
                summary: JSON.stringify(courseSummary(course)),
              },
            })),
          truncated: remaining.length > limit,
        };
      },
    };
    const adapter = new R2CourseStore(bucket);
    const first = await adapter.list();
    expect(first.courses).toHaveLength(24);
    expect(first.courses[0]).toEqual(courseSummary(courses[0]));
    const last = await adapter.list(parseCourseCursor(first.cursor!));
    expect(last.courses).toHaveLength(6);
    expect(last.cursor).toBeUndefined();
    expect(
      [...first.courses, ...last.courses].map((course) => course.id),
    ).toEqual(courses.map((course) => course.id));
    expect(JSON.stringify(first)).not.toContain("segments");
    await expect(adapter.get(fixture.id)).rejects.toThrow(
      "Course bodies are unavailable",
    );
  });

  it("creates one R2 object with its summary and returns the concurrent winner", async () => {
    const course = importCourseGpx(gpx, {
      id: "course-11111111-1111-5111-8111-111111111111",
      createdAt: "2026-10-21T00:00:00Z",
      filename: "route.gpx",
      activity: "Walk",
    });
    let stored: { value: string; metadata: Record<string, string> } | undefined;
    const bucket = {
      get: async () =>
        stored ? { json: async () => JSON.parse(stored!.value) } : null,
      put: async (
        _key: string,
        value: string,
        options: { onlyIf: Headers; customMetadata: Record<string, string> },
      ) => {
        if (stored && options.onlyIf.get("If-None-Match") === "*") return null;
        stored = { value, metadata: options.customMetadata };
        return {};
      },
      list: async () => ({
        objects: stored
          ? [{ key: course.id, customMetadata: stored.metadata }]
          : [],
        truncated: false,
      }),
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        new R2CourseStore(bucket).put({
          ...course,
          createdAt: `2026-10-21T00:00:0${index}Z`,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const winner = await new R2CourseStore(bucket).get(course.id);
    expect(
      results.every((result) => result.course.createdAt === winner!.createdAt),
    ).toBe(true);
    expect((await new R2CourseStore(bucket).list()).courses).toEqual([
      courseSummary(winner!),
    ]);
  });

  it("preserves the winning local save across concurrent writers", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "godiesel-courses-"));
    temporary.push(directory);
    const course = importCourseGpx(gpx, {
      id: "course-11111111-1111-5111-8111-111111111111",
      createdAt: "2026-10-21T00:00:00Z",
      filename: "route.gpx",
      activity: "Walk",
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        new FileCourseStore(directory).put({
          ...course,
          createdAt: `2026-10-21T00:00:0${index}Z`,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const winner = await new FileCourseStore(directory).get(course.id);
    expect(
      results.every((result) => result.course.createdAt === winner!.createdAt),
    ).toBe(true);
    expect((await new FileCourseStore(directory).list()).courses).toEqual([
      courseSummary(winner!),
    ]);
  });

  it("indexes legacy files a page at a time and then lists summaries without geometry", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "godiesel-courses-"));
    temporary.push(directory);
    const course = importCourseGpx(gpx, {
      id: "course-11111111-1111-5111-8111-111111111111",
      createdAt: "2026-10-21T00:00:00Z",
      filename: "route.gpx",
      activity: "Walk",
    });
    const courses = Array.from({ length: 25 }, (_, index) => ({
      ...course,
      id: `course-${String(index).padStart(8, "0")}-1111-5111-8111-111111111111`,
    }));
    for (const legacy of courses)
      await writeFile(
        path.join(directory, `${legacy.id}.json`),
        JSON.stringify(legacy),
      );
    const first = await new FileCourseStore(directory).list();
    expect(first.courses).toHaveLength(24);
    await writeFile(
      path.join(directory, `${courses[0].id}.json`),
      "unreadable geometry",
    );
    expect(await new FileCourseStore(directory).list()).toEqual(first);
    const second = await new FileCourseStore(directory).list(
      parseCourseCursor(first.cursor!),
    );
    expect(second).toEqual({ courses: [courseSummary(courses[24])] });
    await expect(
      new FileCourseStore(directory).get(courses[0].id),
    ).rejects.toThrow();
  });
});
