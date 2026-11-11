#!/usr/bin/env node
// Name what dist/ is, so nobody deploys the wrong kind of bundle.
//
// make-dist.sh deletes the previous manifest before it touches dist/ and writes
// a new one as its very last step. A dist/ without a manifest is therefore an
// interrupted or failed build, and a manifest whose digest no longer matches
// means dist/ changed after packaging. The manifest lives outside dist/ so the
// deployed bytes are unchanged.
//
//   node scripts/dist-manifest.mjs write --scope full|single-route [--slug S]
//        --git-sha SHA --dirty true|false
//   node scripts/dist-manifest.mjs check --scope full|single-route [--slug S]
//        [--dist DIR] [--manifest FILE]
//
// `check` exits non-zero unless the manifest exists, names the expected scope
// (and slug), and dist/ still has exactly the recorded files and bytes.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SCOPES = new Set(["full", "single-route"]);

function fail(message) {
  console.error(`Dist manifest check failed: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined) {
      fail(`unexpected argument ${JSON.stringify(flag)}`);
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

function walk(directory, prefix, entries) {
  for (const name of fs.readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      walk(absolute, relative, entries);
    } else if (stat.isSymbolicLink()) {
      entries.push({ relative, line: `link\t${fs.readlinkSync(absolute)}` });
    } else {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      entries.push({ relative, line: `${stat.size}\t${hash}` });
    }
  }
  return entries;
}

// Deterministic: every path, its size, and its content hash, in byte order.
function describe(distDirectory) {
  const entries = walk(distDirectory, "", []);
  entries.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  const digest = crypto.createHash("sha256");
  for (const entry of entries) digest.update(`${entry.relative}\t${entry.line}\n`);
  return { file_count: entries.length, content_digest: `sha256:${digest.digest("hex")}` };
}

function expectedScope(options) {
  const scope = options.scope;
  if (!SCOPES.has(scope)) fail("--scope must be full or single-route");
  const slug = options.slug ?? null;
  if (scope === "single-route" && !(slug && /^[A-Za-z0-9._-]+$/.test(slug))) {
    fail("a single-route scope needs a safe --slug");
  }
  if (scope === "full" && slug !== null) fail("a full scope takes no --slug");
  return { scope, slug };
}

function write(options) {
  const { scope, slug } = expectedScope(options);
  const distDirectory = path.join(root, "dist");
  const manifestPath = path.join(root, ".dist-manifest.json");
  if (!fs.existsSync(distDirectory)) fail("dist/ does not exist");
  const manifest = {
    scope,
    slug,
    git_sha: options["git-sha"] || "unknown",
    dirty: options.dirty === "true" ? true : options.dirty === "false" ? false : null,
    built_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...describe(distDirectory),
  };
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporary, manifestPath);
  console.log(`Dist manifest written: ${scope}${slug ? ` ${slug}` : ""}, ${manifest.file_count} files`);
}

function check(options) {
  const { scope, slug } = expectedScope(options);
  const distDirectory = path.resolve(options.dist ?? path.join(root, "dist"));
  const manifestPath = path.resolve(options.manifest ?? path.join(root, ".dist-manifest.json"));

  if (!fs.existsSync(manifestPath)) {
    fail(
      `no dist manifest at ${manifestPath}. dist/ has no recorded identity: the last ` +
        "build failed, was interrupted, or predates manifests. Rebuild with ./make-dist.sh.",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`the dist manifest is unreadable (${error.name}). Rebuild with ./make-dist.sh.`);
  }
  if (manifest.scope !== scope) {
    const what =
      manifest.scope === "single-route"
        ? `a single-route bundle for ${manifest.slug}`
        : `a ${manifest.scope} build`;
    fail(`dist/ is ${what}, not a ${scope} build. Refusing to treat it as ${scope}.`);
  }
  if ((manifest.slug ?? null) !== slug) {
    fail(`dist/ was built for route ${manifest.slug}, not ${slug}.`);
  }
  if (!fs.existsSync(distDirectory)) fail(`${distDirectory} does not exist`);
  const current = describe(distDirectory);
  if (
    current.content_digest !== manifest.content_digest ||
    current.file_count !== manifest.file_count
  ) {
    fail(
      `${distDirectory} does not match its manifest (${current.file_count} files now, ` +
        `${manifest.file_count} recorded): it changed after packaging. Rebuild with ./make-dist.sh.`,
    );
  }
  const dirty = manifest.dirty ? " (built from a dirty worktree)" : "";
  console.log(
    `Dist manifest ok: ${manifest.scope}${manifest.slug ? ` ${manifest.slug}` : ""}, ` +
      `${manifest.file_count} files, ${manifest.git_sha}${dirty}, built ${manifest.built_at}`,
  );
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArguments(rest);
if (command === "write") write(options);
else if (command === "check") check(options);
else fail("usage: dist-manifest.mjs write|check --scope full|single-route [--slug S]");
