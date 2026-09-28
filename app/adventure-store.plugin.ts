// Serve the local adventure store (repository-root `.adventures/`) to dev and
// preview only. Builds never include it: publishing an adventure is a separate,
// audience-specific decision, so a built site simply has no adventures.

import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";

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

function middleware(store: string, base: string): Connect.NextHandleFunction {
  const prefix = `${base.replace(/\/?$/, "/")}adventures/`;
  return (request, response, next) => {
    const url = request.url?.split("?")[0] ?? "";
    if (!url.startsWith(prefix)) return next();
    const relative = decodeURIComponent(url.slice(prefix.length));
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

export function adventureStore(store: string): Plugin {
  const root = path.resolve(store);
  return {
    name: "godiesel-adventure-store",
    configureServer(server) {
      server.middlewares.use(middleware(root, server.config.base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(root, server.config.base));
    },
  };
}
