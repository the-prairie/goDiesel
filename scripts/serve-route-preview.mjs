#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [directory = "dist", host = "127.0.0.1", portValue] = process.argv.slice(2);
const port = Number(portValue);
const root = path.resolve(directory);

if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("Route preview requires loopback host and a valid port.");
  process.exit(1);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://preview.local").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  let stats;
  try {
    stats = fs.statSync(candidate);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  if (!stats.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(path.extname(candidate).toLowerCase()) ?? "application/octet-stream",
  });
  fs.createReadStream(candidate).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Route preview listening on http://${host}:${port}/`);
});
