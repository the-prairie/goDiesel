import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  COURSE_PAGE_SIZE,
  courseCursor,
  courseSummary,
  parseCourse,
  parseCourseSummary,
  type Course,
  type CoursePage,
} from "../src/domain/courses";
import { coursesResponse, type CourseStore } from "./courses";

const ID =
  /^course-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function defaultCourseStoreDirectory(root: string) {
  const workspace = createHash("sha256")
    .update(realpathSync(root))
    .digest("hex")
    .slice(0, 24);
  return path.join(
    homedir(),
    ".local",
    "share",
    "godiesel",
    "workspaces",
    workspace,
    "courses",
  );
}

function containsPath(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function canonicalPath(filename: string): string {
  let current = filename;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return path.resolve(filename);
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(filename);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export class FileCourseStore implements CourseStore {
  constructor(private directory: string) {}

  async list(after?: string): Promise<CoursePage> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory))
      .filter(
        (name) =>
          name.endsWith(".json") &&
          ID.test(name.slice(0, -5)) &&
          (!after || name.slice(0, -5) > after),
      )
      .sort();
    const courses = [];
    for (const name of names.slice(0, COURSE_PAGE_SIZE)) {
      const id = name.slice(0, -5);
      try {
        const summary = parseCourseSummary(
          JSON.parse(await readFile(this.summaryPath(id), "utf8")),
        );
        if (summary.id !== id) throw new Error("Invalid course metadata.");
        courses.push(summary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const course = await this.get(id);
        if (course) {
          await this.writeSummary(course);
          courses.push(courseSummary(course));
        }
      }
    }
    return {
      courses,
      ...(names.length > COURSE_PAGE_SIZE
        ? { cursor: courseCursor(names[COURSE_PAGE_SIZE - 1].slice(0, -5)) }
        : {}),
    };
  }

  private summaryPath(id: string) {
    return path.join(this.directory, ".summaries", `${id}.json`);
  }

  private async writeSummary(course: Course) {
    const filename = this.summaryPath(course.id);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(courseSummary(course)), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async get(id: string): Promise<Course | null> {
    if (!ID.test(id)) throw new Error("Invalid course ID");
    try {
      return parseCourse(
        JSON.parse(
          await readFile(path.join(this.directory, `${id}.json`), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(course: Course) {
    if (!ID.test(course.id)) throw new Error("Invalid course ID");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(
      this.directory,
      `${course.id}.${crypto.randomUUID()}.tmp`,
    );
    let created = true;
    try {
      await writeFile(temporary, JSON.stringify(course), {
        mode: 0o600,
        flag: "wx",
      });
      try {
        await link(temporary, path.join(this.directory, `${course.id}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        created = false;
      }
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    const saved = created ? course : await this.get(course.id);
    if (!saved) throw new Error("Saved course is unavailable.");
    await this.writeSummary(saved);
    return { course: saved, created };
  }
}

export function coursesPlugin(
  options: {
    token?: string;
    routerUrl?: string;
    signingKey?: string;
    storeDirectory?: string;
  } = {},
): Plugin {
  let root = process.cwd();
  let directory = "";
  let store: CourseStore;
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    let pathname: string;
    try {
      pathname = path.posix.normalize(
        decodeURIComponent(
          new URL(req.url ?? "/", "http://localhost").pathname,
        ).replaceAll("\\", "/"),
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const requestedFile = canonicalPath(
      pathname.startsWith("/@fs/")
        ? pathname.slice(4)
        : path.join(root, pathname),
    );
    if (
      pathname.includes("/.local/courses/") ||
      pathname.endsWith("/.local/courses") ||
      containsPath(directory, requestedFile)
    ) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (req.url?.split("?")[0] !== "/api/courses") return next();
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 5 * 1024 * 1024) {
          res.writeHead(413, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(
            JSON.stringify({
              error: "The file or request is too large. Maximum size is 5 MB.",
            }),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(", "));
      }
      const request = new Request(
        `http://${req.headers.host ?? "localhost"}${req.url}`,
        {
          method: req.method,
          headers,
          signal: controller.signal,
          ...(chunks.length && req.method !== "GET" && req.method !== "HEAD"
            ? { body: Buffer.concat(chunks) }
            : {}),
        },
      );
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      );
      store ??= new FileCourseStore(directory);
      const response = await coursesResponse(request, {
        store,
        token: options.token ?? process.env.GODIESEL_COURSE_TOKEN,
        routerUrl: options.routerUrl ?? process.env.GODIESEL_ROUTER_URL,
        signingKey:
          options.signingKey ?? process.env.GODIESEL_COURSE_SIGNING_KEY,
        localDevelopment: loopback,
      });
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(await response.text());
    } catch {
      if (res.writableEnded) return;
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: "Course storage is temporarily unavailable. Try again.",
        }),
      );
    }
  };
  return {
    name: "godiesel-courses",
    configResolved(config) {
      root = realpathSync(config.root);
      directory = canonicalPath(
        path.resolve(
          options.storeDirectory ?? defaultCourseStoreDirectory(root),
        ),
      );
      if (containsPath(root, directory))
        throw new Error("Course storage must be outside the Vite served root.");
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
