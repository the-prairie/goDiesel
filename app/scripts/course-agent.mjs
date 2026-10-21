#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const command = args.shift();
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--save") flags.set("save", true);
  else if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    if (
      !["base-url", "activity", "name", "output"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    ) {
      process.stderr.write(
        JSON.stringify({ error: `Invalid option ${args[i]}` }) + "\n",
      );
      process.exit(1);
    }
    flags.set(key, args[++i]);
  } else positional.push(args[i]);
}

async function main() {
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(
      `goDiesel course agent\n\nCommands\n  list\n  generate [--save] < request.json\n  import route.gpx --activity Run|Walk|Ride [--name "My route"] [--save]\n  get course-ID\n  export course-ID [--output route.gpx]\n\nOptions\n  --base-url http://127.0.0.1:8787\n  GODIESEL_COURSE_TOKEN supplies the owner bearer token.\n\nGenerate reads a JSON CourseRequest from stdin. An unsaved preview is returned unless --save is present.\n`,
    );
    return;
  }
  const base = new URL(
    flags.get("base-url") ??
      process.env.GODIESEL_BASE_URL ??
      "http://127.0.0.1:8787",
  );
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error("Use an HTTP or HTTPS base URL without credentials.");
  if (
    process.env.GODIESEL_COURSE_TOKEN &&
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error(
      "Use HTTPS when sending an owner token to a remote server.",
    );
  async function request(query = "", body) {
    const response = await fetch(new URL(`/api/courses${query}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(process.env.GODIESEL_COURSE_TOKEN
          ? { Authorization: `Bearer ${process.env.GODIESEL_COURSE_TOKEN}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(70_000),
      redirect: "error",
    });
    if (!response.ok) {
      let message = `Course API returned ${response.status}.`;
      try {
        message = (await response.json()).error ?? message;
      } catch {}
      throw new Error(message);
    }
    return response;
  }
  let result;
  if (command === "list") result = await (await request()).json();
  else if (command === "get" || command === "export") {
    const id = positional[0];
    if (!/^course-[0-9a-f-]{36}$/.test(id ?? ""))
      throw new Error("Supply a valid course ID.");
    const response = await request(
      `?id=${encodeURIComponent(id)}${command === "export" ? "&format=gpx" : ""}`,
    );
    if (command === "export") {
      const gpx = await response.text();
      if (flags.has("output")) {
        await writeFile(flags.get("output"), gpx, { flag: "wx" });
        result = { file: path.resolve(flags.get("output")), courseId: id };
      } else {
        process.stdout.write(gpx);
        return;
      }
    } else result = await response.json();
  } else if (command === "generate") {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 5 * 1024 * 1024) throw new Error("Request exceeds 5 MB.");
      chunks.push(chunk);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Generate requires a JSON CourseRequest on stdin.");
    }
    result = await (
      await request("", { action: "generate", request: input })
    ).json();
  } else if (command === "import") {
    if (
      !positional[0] ||
      !["Run", "Walk", "Ride"].includes(flags.get("activity"))
    )
      throw new Error(
        "Import requires a GPX filename and --activity Run, Walk or Ride.",
      );
    const gpx = await readFile(positional[0], "utf8");
    if (Buffer.byteLength(gpx) > 5 * 1024 * 1024)
      throw new Error("GPX file exceeds 5 MB.");
    result = await (
      await request("", {
        action: "import",
        gpx,
        filename: path.basename(positional[0]),
        activity: flags.get("activity"),
        name: flags.get("name"),
      })
    ).json();
  } else throw new Error(`Unknown command ${command}. Use help.`);
  if (
    result.course &&
    flags.has("save") &&
    ["generate", "import"].includes(command)
  )
    result = await (
      await request("", {
        action: "save",
        course: result.course,
        receipt: result.receipt,
      })
    ).json();
  if (result.course) {
    result.saved = command === "get" || flags.has("save");
    if (result.saved)
      result.url = new URL(`/#/courses/${result.course.id}`, base).href;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({ error: error.message ?? "Course operation failed." }) +
      "\n",
  );
  process.exitCode = 1;
});
