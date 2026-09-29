// Serve the local adventure store (repository-root `.adventures/`) to dev and
// preview only. Builds never include it: publishing an adventure is a separate,
// audience-specific decision, so a built site simply has no adventures.

import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";

import type { Adventure } from "./src/domain/adventure/contract";
import { checkAdventureEdit } from "./src/domain/adventure/edit";
import { parseAdventure, parseAdventureIndex } from "./src/domain/adventure/parse";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
};

/** The only files the runtime reads: the index, each adventure, and its media. */
const SERVED_PATH = /^(?:index\.json|[a-z0-9][a-z0-9_-]*\/adventure\.json|[a-z0-9][a-z0-9_-]*\/media\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;

/**
 * The store holds restricted owner content (copy, footage) and private
 * import and publication reports, while the dev and preview servers listen on
 * the network by default. Reads are for this machine only, through a loopback
 * Host, and only for the files the runtime needs.
 */
export function storeReadProblem(request: { remoteAddress?: string; host?: string; relative: string }) {
  if (!request.remoteAddress || !LOOPBACK.has(request.remoteAddress)) return "The adventure store is served to this machine only.";
  const hostName = request.host?.replace(/:\d+$/, "");
  if (!hostName || !LOOPBACK_HOSTS.has(hostName)) return "The request host must be loopback.";
  if (!SERVED_PATH.test(request.relative) || request.relative.split("/").includes("..")) return "That file is not served.";
  return undefined;
}

function middleware(store: string, base: string): Connect.NextHandleFunction {
  const prefix = `${base.replace(/\/?$/, "/")}adventures/`;
  return (request, response, next) => {
    const url = request.url?.split("?")[0] ?? "";
    if (!url.startsWith(prefix)) return next();
    const relative = decodeURIComponent(url.slice(prefix.length));
    const refused = storeReadProblem({ remoteAddress: request.socket.remoteAddress, host: request.headers.host, relative });
    if (refused) {
      response.statusCode = refused.includes("not served") ? 404 : 403;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: refused }));
      return;
    }
    const file = path.resolve(store, relative);
    if (!file.startsWith(`${store}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "not-found" }));
      return;
    }
    const size = fs.statSync(file).size;
    response.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "no-cache");
    // Video seeking needs byte ranges; Safari refuses to play without them.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start > end || start >= size) {
        response.statusCode = 416;
        response.setHeader("Content-Range", `bytes */${size}`);
        response.end();
        return;
      }
      response.statusCode = 206;
      response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      response.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.setHeader("Content-Length", String(size));
    fs.createReadStream(file).pipe(response);
  };
}

const WRITE_LIMIT_BYTES = 2_000_000;

/**
 * The owner's local writer accepts a same-origin JSON PUT from this machine
 * only. The dev server listens on the network, so the remote address, the
 * Host (against DNS rebinding) and the Origin (against other pages in the
 * owner's browser) are all checked.
 */
export function writerRequestProblem(request: {
  method?: string;
  remoteAddress?: string;
  host?: string;
  origin?: string;
  contentType?: string;
}) {
  if (request.method !== "PUT") return "Only PUT is accepted.";
  if (!request.remoteAddress || !LOOPBACK.has(request.remoteAddress)) return "Writes are accepted from this machine only.";
  const hostName = request.host?.replace(/:\d+$/, "");
  if (!hostName || !LOOPBACK_HOSTS.has(hostName)) return "The request host must be loopback.";
  let origin: URL;
  try {
    origin = new URL(request.origin ?? "");
  } catch {
    return "A same-origin request is required.";
  }
  if (origin.host !== request.host) return "A same-origin request is required.";
  if (!request.contentType?.startsWith("application/json")) return "The body must be JSON.";
  return undefined;
}

function readBody(request: Connect.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > WRITE_LIMIT_BYTES) {
        reject(new Error("The body is too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writeAtomically(file: string, text: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

/** Dev only: owner edits to an imported adventure, and its publication plan. */
function writer(store: string, base: string): Connect.NextHandleFunction {
  const prefix = `${base.replace(/\/?$/, "/")}__adventure-writer/`;
  return (request, response, next) => {
    const url = request.url?.split("?")[0] ?? "";
    if (!url.startsWith(prefix)) return next();
    const reply = (status: number, body: unknown) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(body));
    };
    const problem = writerRequestProblem({
      method: request.method,
      remoteAddress: request.socket.remoteAddress,
      host: request.headers.host,
      origin: request.headers.origin,
      contentType: request.headers["content-type"],
    });
    if (problem) return reply(403, { error: problem });
    const [id, part] = url.slice(prefix.length).split("/");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id ?? "") || (part && part !== "publication-plan")) return reply(404, { error: "not-found" });
    const directory = path.join(store, id);
    const file = path.join(directory, "adventure.json");
    if (!fs.existsSync(file)) return reply(404, { error: "No such local adventure." });

    readBody(request).then((text) => {
      const body = JSON.parse(text) as unknown;
      if (part === "publication-plan") {
        if (!body || typeof body !== "object" || !("checks" in body)) return reply(422, { error: "A publication plan needs its checks." });
        writeAtomically(path.join(directory, "publication-plan.json"), `${JSON.stringify(body, null, 2)}\n`);
        return reply(200, { saved: "publication-plan.json" });
      }
      const saved = parseAdventure(JSON.parse(fs.readFileSync(file, "utf8")));
      let next: Adventure;
      try {
        next = parseAdventure(body);
      } catch (error) {
        return reply(422, { error: error instanceof Error ? error.message : "The adventure is invalid." });
      }
      const refused = checkAdventureEdit(saved, next);
      if (refused.length) return reply(422, { error: refused.join(" ") });
      writeAtomically(file, `${JSON.stringify(next, null, 2)}\n`);
      const index = parseAdventureIndex({
        schemaVersion: 1,
        adventures: fs.readdirSync(store, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(store, entry.name, "adventure.json")))
          .map((entry) => parseAdventure(JSON.parse(fs.readFileSync(path.join(store, entry.name, "adventure.json"), "utf8"))))
          .map((item) => ({ id: item.id, title: item.title, legs: item.legs.map((leg) => leg.slug) })),
      });
      writeAtomically(path.join(store, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
      return reply(200, { saved: "adventure.json" });
    }).catch((error: unknown) => reply(400, { error: error instanceof Error ? error.message : "The request could not be read." }));
  };
}

export function adventureStore(store: string): Plugin {
  const root = path.resolve(store);
  // Repository gates set this so their result never depends on ignored local
  // owner content: with it, the servers behave exactly like a build.
  if (process.env.GODIESEL_LOCAL_ADVENTURES === "0") return { name: "godiesel-adventure-store" };
  return {
    name: "godiesel-adventure-store",
    configureServer(server) {
      server.middlewares.use(writer(root, server.config.base));
      server.middlewares.use(middleware(root, server.config.base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(root, server.config.base));
    },
  };
}
