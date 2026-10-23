import { generateOrsCourse, OrsError } from "./ors";
import {
  courseGpx,
  parseCourseCursor,
  type CoursePage,
  courseStats,
  importCourseGpx,
  parseCourse,
  parseCourseRequest,
  type Course,
  type CoursePoint,
  type CourseRequest,
} from "../src/domain/courses";

export interface CourseStore {
  list(after?: string): Promise<CoursePage>;
  get(id: string): Promise<Course | null>;
  put(course: Course): Promise<{ course: Course; created: boolean }>;
}

export interface CourseApiOptions {
  store?: CourseStore;
  token?: string;
  routerUrl?: string;
  orsApiKey?: string;
  nextgisOverpassKey?: string;
  signingKey?: string;
  localDevelopment?: boolean;
  fetch?: typeof fetch;
}

const BODY_LIMIT = 5 * 1024 * 1024;
const ID =
  /^course-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
let localReceiptKey: Uint8Array<ArrayBuffer> | undefined;

class CourseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new CourseApiError(
          413,
          "The file or request is too large. Maximum size is 5 MB.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function stableCourse(course: Course): Promise<Course> {
  const { id: _id, createdAt: _createdAt, ...content } = course;
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(content)),
    ),
  );
  digest[6] = (digest[6] & 15) | 80;
  digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest.slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    ...course,
    id: `course-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}

async function receiptKey(options: CourseApiOptions) {
  if (options.signingKey && options.signingKey === options.token)
    throw new CourseApiError(
      503,
      "The server signing key must be separate from the owner access token.",
    );
  const bytes = options.signingKey
    ? new TextEncoder().encode(options.signingKey)
    : options.localDevelopment
      ? (localReceiptKey ??= crypto.getRandomValues(new Uint8Array(32)))
      : undefined;
  if (!bytes || bytes.byteLength < 32)
    throw new CourseApiError(
      503,
      "Route generation needs a server signing key of at least 32 bytes.",
    );
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signCourse(course: Course, options: CourseApiOptions) {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await receiptKey(options),
      new TextEncoder().encode(JSON.stringify(course)),
    ),
  );
  return btoa(String.fromCharCode(...signature))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function verifyCourseReceipt(
  course: Course,
  receipt: unknown,
  options: CourseApiOptions,
) {
  if (typeof receipt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(receipt))
    return false;
  const signature = Uint8Array.from(
    atob(receipt.replaceAll("-", "+").replaceAll("_", "/") + "="),
    (char) => char.charCodeAt(0),
  );
  return crypto.subtle.verify(
    "HMAC",
    await receiptKey(options),
    signature,
    new TextEncoder().encode(JSON.stringify(course)),
  );
}

function brouterProfile(request: CourseRequest) {
  return request.activity === "Ride"
    ? request.vibes.includes("paved")
      ? "fastbike"
      : "trekking"
    : "hiking-mountain";
}

export function brouterRequest(
  request: CourseRequest,
  endpoint: string,
  radius: number,
  direction: number,
): URL {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new CourseApiError(
      503,
      "The routing service is not configured correctly.",
    );
  const cycling = request.activity === "Ride";
  url.searchParams.set("lonlats", `${request.start.lng},${request.start.lat}`);
  url.searchParams.set("profile", brouterProfile(request));
  url.searchParams.set("format", "geojson");
  url.searchParams.set("engineMode", "4");
  url.searchParams.set("roundTripDistance", String(Math.round(radius)));
  url.searchParams.set("direction", String(direction));
  url.searchParams.set("profile:allow_ferries", "0");
  url.searchParams.set("profile:add_beeline", "0");
  url.searchParams.set(
    "profile:consider_noise",
    request.vibes.includes("quiet") ? "1" : "0",
  );
  url.searchParams.set(
    "profile:consider_forest",
    request.vibes.includes("green") ? "1" : "0",
  );
  url.searchParams.set(
    "profile:consider_river",
    request.vibes.includes("water") ? "1" : "0",
  );
  if (!cycling) {
    url.searchParams.set("profile:SAC_scale_limit", "1");
    url.searchParams.set("profile:SAC_access_penalty", "100000");
  }
  return url;
}

function providerPoints(value: unknown): CoursePoint[] {
  const data = value as {
    type?: unknown;
    features?: { geometry?: { type?: unknown; coordinates?: unknown } }[];
  };
  if (
    !data ||
    data.type !== "FeatureCollection" ||
    !Array.isArray(data.features) ||
    data.features.length !== 1
  )
    throw new CourseApiError(
      502,
      "The routing service returned an invalid route.",
    );
  const geometry = data.features[0]?.geometry;
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 3 ||
    geometry.coordinates.length > 100_000
  )
    throw new CourseApiError(
      502,
      "The routing service did not return a connected route.",
    );
  return geometry.coordinates.map((coordinate: unknown) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      typeof coordinate[0] !== "number" ||
      typeof coordinate[1] !== "number" ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1]) ||
      Math.abs(coordinate[0]) > 180 ||
      Math.abs(coordinate[1]) > 90 ||
      (coordinate[2] !== undefined &&
        (typeof coordinate[2] !== "number" || !Number.isFinite(coordinate[2])))
    )
      throw new CourseApiError(
        502,
        "The routing service returned invalid coordinates.",
      );
    return {
      lat: coordinate[1],
      lng: coordinate[0],
      ...(coordinate[2] === undefined ? {} : { elevationM: coordinate[2] }),
    };
  });
}

async function generateCourse(
  request: CourseRequest,
  options: CourseApiOptions,
  signal: AbortSignal,
): Promise<Course> {
  const endpoint =
    options.routerUrl ||
    (options.localDevelopment ? "https://brouter.de/brouter" : undefined);
  if (!endpoint)
    throw new CourseApiError(
      503,
      "Route generation needs a configured routing service. GPX import is available.",
    );
  const target = request.distance * (request.unit === "mi" ? 1609.344 : 1000);
  let radius = target / 5.2;
  let best:
    | {
        points: CoursePoint[];
        stats: ReturnType<typeof courseStats>;
        error: number;
      }
    | undefined;
  let failure: CourseApiError | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw signal.reason;
    try {
      const url = brouterRequest(
        request,
        endpoint,
        radius,
        (request.seed + (failure ? attempt * 137 : 0)) % 360,
      );
      const response = await (options.fetch ?? fetch)(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(22_000)]),
        headers: { Accept: "application/geo+json, application/json" },
        redirect: "manual",
      });
      if (!response.ok)
        throw new CourseApiError(
          503,
          "The routing service could not find a route here. Try another start or distance.",
        );
      const points = providerPoints(
        JSON.parse(await boundedText(response.body, BODY_LIMIT)),
      );
      const stats = courseStats([points]);
      const separation = (a: CoursePoint, b: CoursePoint) =>
        courseStats([[a, b]]).distanceM;
      if (
        separation(points[0], points.at(-1)!) > 80 ||
        separation(request.start, points[0]) > 500 ||
        points.some(
          (point, index) =>
            index > 0 && separation(points[index - 1], point) > 1000,
        )
      )
        throw new CourseApiError(
          502,
          "The routing service could not return a connected loop near your start.",
        );
      const error = Math.abs(stats.distanceM - target) / target;
      if (!best || error < best.error) best = { points, stats, error };
      if (error <= 0.1) break;
      radius = Math.max(
        150,
        Math.min(45_000, (radius * target) / stats.distanceM),
      );
      failure = undefined;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      failure =
        error instanceof CourseApiError
          ? error
          : new CourseApiError(
              503,
              "The routing service is unavailable. Try again shortly.",
            );
    }
  }
  if (!best)
    throw (
      failure ?? new CourseApiError(503, "No route was found near this start.")
    );
  if (best.error > 0.3)
    throw new CourseApiError(
      422,
      `No loop close enough to your target was found. The closest was ${(best.stats.distanceM / 1000).toFixed(1)} km. Try another distance or start.`,
    );
  const warnings = [
    "Preferences use mapped features, not verified current conditions. Review the route before heading out.",
  ];
  if (best.error > 0.1)
    warnings.unshift(
      `This loop is ${Math.round(best.error * 100)}% ${best.stats.distanceM > target ? "longer" : "shorter"} than requested.`,
    );
  if (request.hills && request.hills !== "any")
    warnings.push("Hill comparison requires the ORS planner. This BRouter course did not apply your hills preference.");
  if (request.activity !== "Ride" && request.vibes.includes("paved"))
    warnings.push(
      "The walking/running routing profile cannot enforce paved surfaces. Check the route surface before using it.",
    );
  const activity = { Run: "run", Walk: "walk", Ride: "ride" }[request.activity];
  return stableCourse(
    parseCourse({
      id: `course-${crypto.randomUUID()}`,
      name: `${request.start.name.split(",")[0].slice(0, 170).trim()} ${activity} loop`,
      description:
        `A ${(best.stats.distanceM / 1000).toFixed(1)} km ${activity} loop from ${request.start.name}. ${request.vibes.length ? `Requested preferences: ${request.vibes.join(", ")}.` : ""}`.trim(),
      activity: request.activity,
      createdAt: new Date().toISOString(),
      source: {
        kind: "generated",
        provider: "brouter",
        request,
        profile: brouterProfile(request),
      },
      segments: [best.points],
      ...best.stats,
      warnings,
    }),
  );
}

export async function coursesResponse(
  request: Request,
  options: CourseApiOptions,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const local = options.localDevelopment && LOCAL_HOSTS.has(url.hostname);
    const executionOptions = { ...options, localDevelopment: Boolean(local) };
    const origin = request.headers.get("Origin");
    if (
      (origin && origin !== url.origin) ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      throw new CourseApiError(403, "Cross-origin requests are not allowed.");
    if (!options.store || (!local && !options.token))
      throw new CourseApiError(
        503,
        "Course storage is not configured for this server.",
      );
    if (
      options.token &&
      request.headers.get("Authorization") !== `Bearer ${options.token}`
    )
      throw new CourseApiError(401, "An owner access token is required.");
    if (!["GET", "POST"].includes(request.method))
      throw new CourseApiError(405, "Method not allowed.");
    const id = url.searchParams.get("id");
    if (request.method === "GET") {
      if (!id) {
        let after: string | undefined;
        const cursor = url.searchParams.get("cursor");
        if (cursor !== null) {
          try {
            after = parseCourseCursor(cursor);
          } catch {
            throw new CourseApiError(400, "Invalid course cursor.");
          }
        }
        return json(await options.store.list(after));
      }
      if (!ID.test(id)) throw new CourseApiError(400, "Invalid course ID.");
      const course = await options.store.get(id);
      if (!course) throw new CourseApiError(404, "Course not found.");
      if (url.searchParams.get("format") === "gpx")
        return new Response(courseGpx(course), {
          headers: {
            "Content-Type": "application/gpx+xml; charset=utf-8",
            "Content-Disposition": `attachment; filename="${course.id}.gpx"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      return json({ course });
    }
    if (
      !request.headers
        .get("Content-Type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new CourseApiError(415, "Send an application/json request.");
    if (Number(request.headers.get("Content-Length")) > BODY_LIMIT)
      throw new CourseApiError(
        413,
        "The file or request is too large. Maximum size is 5 MB.",
      );
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(
        await boundedText(request.body, BODY_LIMIT),
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      body = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof CourseApiError) throw error;
      throw new CourseApiError(400, "The request must contain valid JSON.");
    }
    if (body.action === "generate") {
      let input: CourseRequest;
      try {
        input = parseCourseRequest(body.request);
      } catch {
        throw new CourseApiError(
          400,
          "Enter a valid start, distance, activity and preferences.",
        );
      }
      await receiptKey(executionOptions);
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(65_000),
      ]);
      const course = options.orsApiKey
        ? await stableCourse(await generateOrsCourse(input, options.orsApiKey, signal, options.fetch, options.nextgisOverpassKey))
        : await generateCourse(input, executionOptions, signal);
      return json({
        course,
        receipt: await signCourse(course, executionOptions),
      });
    }
    if (body.action === "import") {
      if (
        typeof body.gpx !== "string" ||
        typeof body.filename !== "string" ||
        !["Run", "Walk", "Ride"].includes(String(body.activity)) ||
        (body.name !== undefined && typeof body.name !== "string")
      )
        throw new CourseApiError(400, "Choose a GPX file and an activity.");
      try {
        const course = importCourseGpx(body.gpx, {
          id: `course-${crypto.randomUUID()}`,
          createdAt: new Date().toISOString(),
          filename: body.filename,
          activity: body.activity as Course["activity"],
          name: body.name as string | undefined,
        });
        return json({ course: await stableCourse(course) });
      } catch {
        throw new CourseApiError(
          400,
          "The GPX file could not be imported. Use a valid GPX track or route with coordinates.",
        );
      }
    }
    if (body.action === "save") {
      let course: Course;
      try {
        course = await stableCourse(parseCourse(body.course));
      } catch {
        throw new CourseApiError(
          400,
          "The course is invalid. Generate or import it again.",
        );
      }
      if (
        course.source.kind === "generated" &&
        !(await verifyCourseReceipt(course, body.receipt, executionOptions))
      )
        throw new CourseApiError(
          400,
          "The generated route receipt is missing or invalid. Generate this route again before saving.",
        );
      const existing = await options.store.get(course.id);
      if (existing) return json({ course: existing });
      const saved = await options.store.put(course);
      return json({ course: saved.course }, saved.created ? 201 : 200);
    }
    throw new CourseApiError(400, "Choose generate, import or save.");
  } catch (error) {
    if (error instanceof CourseApiError || error instanceof OrsError)
      return json({ error: error.message }, error.status);
    if (
      error instanceof DOMException &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      return json(
        { error: "The request was cancelled or timed out. Try again." },
        408,
      );
    return json(
      { error: "Course storage is temporarily unavailable. Try again." },
      503,
    );
  }
}
