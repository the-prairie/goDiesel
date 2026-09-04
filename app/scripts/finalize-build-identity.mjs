import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(appRoot, "dist");
const identityPath = path.join(distRoot, "build-identity.json");
const manifestPath = path.join(distRoot, "artifact-manifest.json");
const excluded = new Set([
  "_headers",
  "_redirects",
  "artifact-manifest.json",
  "build-identity.json",
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Built artifact contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...artifactFiles(absolutePath, relativePath));
    } else if (entry.isFile() && !excluded.has(relativePath)) {
      const bytes = fs.readFileSync(absolutePath);
      files.push({ path: relativePath, size: bytes.length, sha256: digest(bytes) });
    }
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
const manifest = {
  schema_version: 1,
  document_type: "godiesel-artifact-manifest",
  files: artifactFiles(distRoot),
};
const manifestBytes = `${JSON.stringify(manifest)}\n`;
fs.writeFileSync(manifestPath, manifestBytes);
fs.writeFileSync(
  identityPath,
  `${JSON.stringify({
    ...identity,
    artifact_manifest_sha256: digest(manifestBytes),
  })}\n`,
);
