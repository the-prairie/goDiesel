import { coursesResponse, type CourseStore } from "../../app/server/courses";
import { parseCourse, type Course } from "../../app/src/domain/courses";

interface CourseKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export class KvCourseStore implements CourseStore {
  constructor(private kv: CourseKv) {}
  async get(id: string) {
    const value = await this.kv.get(id);
    return value === null ? null : parseCourse(JSON.parse(value));
  }
  async put(course: Course) {
    await this.kv.put(course.id, JSON.stringify(course));
  }
  async list() {
    const courses: Course[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: "course-", cursor });
      const values = await Promise.all(
        page.keys.map((key) => this.get(key.name)),
      );
      courses.push(
        ...values.filter((course): course is Course => course !== null),
      );
      cursor = page.list_complete ? undefined : page.cursor;
      if (!page.list_complete && !cursor)
        throw new Error("Incomplete course listing");
    } while (cursor);
    return courses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function onRequest(context: {
  request: Request;
  env: {
    COURSE_STORE?: CourseKv;
    GODIESEL_COURSE_TOKEN?: string;
    GODIESEL_ROUTER_URL?: string;
    GODIESEL_COURSE_SIGNING_KEY?: string;
  };
}) {
  return coursesResponse(context.request, {
    store: context.env.COURSE_STORE
      ? new KvCourseStore(context.env.COURSE_STORE)
      : undefined,
    token: context.env.GODIESEL_COURSE_TOKEN,
    routerUrl: context.env.GODIESEL_ROUTER_URL,
    signingKey: context.env.GODIESEL_COURSE_SIGNING_KEY,
  });
}
