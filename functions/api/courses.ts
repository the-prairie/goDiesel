import { coursesResponse, type CourseStore } from "../../app/server/courses";
import {
  COURSE_PAGE_SIZE,
  courseCursor,
  courseSummary,
  parseCourse,
  parseCourseSummary,
  type Course,
  type CoursePage,
} from "../../app/src/domain/courses";

interface CourseBucket {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  put(
    key: string,
    value: string,
    options: {
      onlyIf: Headers;
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string };
    },
  ): Promise<object | null>;
  list(options: {
    prefix: string;
    startAfter?: string;
    limit: number;
    include: ["customMetadata"];
  }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated: boolean;
  }>;
}

export class R2CourseStore implements CourseStore {
  constructor(private bucket: CourseBucket) {}

  async get(id: string) {
    const value = await this.bucket.get(id);
    return value === null ? null : parseCourse(await value.json());
  }

  async put(course: Course) {
    const created = await this.bucket.put(course.id, JSON.stringify(course), {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      customMetadata: { summary: JSON.stringify(courseSummary(course)) },
      httpMetadata: { contentType: "application/json" },
    });
    if (created) return { course, created: true };
    const winner = await this.get(course.id);
    if (!winner) throw new Error("Saved course is unavailable.");
    return { course: winner, created: false };
  }

  async list(after?: string): Promise<CoursePage> {
    const page = await this.bucket.list({
      prefix: "course-",
      startAfter: after,
      limit: COURSE_PAGE_SIZE,
      include: ["customMetadata"],
    });
    const courses = page.objects.map((entry) => {
      const summary = parseCourseSummary(
        JSON.parse(entry.customMetadata?.summary ?? "null"),
      );
      if (summary.id !== entry.key) throw new Error("Invalid course metadata.");
      return summary;
    });
    const last = courses.at(-1);
    if (page.truncated && !last) throw new Error("Incomplete course listing.");
    return {
      courses,
      ...(page.truncated && last ? { cursor: courseCursor(last.id) } : {}),
    };
  }
}

export function onRequest(context: {
  request: Request;
  env: {
    COURSE_STORE?: CourseBucket;
    GODIESEL_COURSE_TOKEN?: string;
    GODIESEL_ROUTER_URL?: string;
    ORS_API_KEY?: string;
    NEXTGIS_OVERPASS_API_KEY?: string;
    GODIESEL_COURSE_SIGNING_KEY?: string;
  };
}) {
  return coursesResponse(context.request, {
    store: context.env.COURSE_STORE
      ? new R2CourseStore(context.env.COURSE_STORE)
      : undefined,
    token: context.env.GODIESEL_COURSE_TOKEN,
    routerUrl: context.env.GODIESEL_ROUTER_URL,
    orsApiKey: context.env.ORS_API_KEY,
    nextgisOverpassKey: context.env.NEXTGIS_OVERPASS_API_KEY,
    signingKey: context.env.GODIESEL_COURSE_SIGNING_KEY,
  });
}
