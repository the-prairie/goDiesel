import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stageAdventurePublication } from "../scripts/adventure-publication.mjs";
import { syntheticAdventureJson } from "@/domain/adventure/adventure-fixtures";

let root: string;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function setUp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "adventure-publication-"));
  const store = path.join(root, "store");
  const dist = path.join(root, "dist");
  const directory = path.join(store, "ridge-day");
  fs.mkdirSync(path.join(directory, "media"), { recursive: true });
  const adventure = syntheticAdventureJson() as Record<string, any>;
  for (const clip of adventure.footage) {
    const body = `synthetic ${clip.id}`;
    fs.writeFileSync(path.join(directory, clip.src), body);
    clip.sha256 = sha(body);
    if (clip.poster) fs.writeFileSync(path.join(directory, clip.poster), `poster ${clip.id}`);
  }
  fs.writeFileSync(path.join(directory, "adventure.json"), JSON.stringify(adventure));
  fs.writeFileSync(path.join(directory, "import-report.json"), "{\"private\":true}");
  fs.writeFileSync(path.join(directory, "publication-plan.json"), "{\"checks\":[]}");
  fs.writeFileSync(path.join(directory, "media", "unreferenced.mp4"), "not referenced");
  fs.mkdirSync(path.join(dist, "data", "routes"), { recursive: true });
  for (const slug of ["leg-one", "leg-two"]) fs.writeFileSync(path.join(dist, "data", "routes", `${slug}.json`), "{}");
  return { store, dist };
}

const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(directory, entry.name)).map((file) => `${entry.name}/${file}`) : [entry.name],
  );

describe("stageAdventurePublication", () => {
  let paths: ReturnType<typeof setUp>;
  beforeEach(() => { paths = setUp(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("refuses without the owner's approval for that exact adventure", () => {
    expect(() => stageAdventurePublication({ ...paths, id: "ridge-day" })).toThrow(/approval/);
    expect(() => stageAdventurePublication({ ...paths, id: "ridge-day", approval: "another" })).toThrow(/approval/);
    expect(fs.existsSync(path.join(paths.dist, "adventures"))).toBe(false);
  });

  it("stages only the adventure, its referenced media and a one-entry index", () => {
    const manifest = stageAdventurePublication({ ...paths, id: "ridge-day", approval: "ridge-day" });
    expect(files(path.join(paths.dist, "adventures")).sort()).toEqual([
      "index.json",
      "ridge-day/adventure.json",
      "ridge-day/media/clip-a.jpg",
      "ridge-day/media/clip-a.mp4",
      "ridge-day/media/clip-b.mp4",
    ]);
    const index = JSON.parse(fs.readFileSync(path.join(paths.dist, "adventures", "index.json"), "utf8"));
    expect(index.adventures.map((item: { id: string }) => item.id)).toEqual(["ridge-day"]);
    expect(manifest.files.every((file: { sha256: string }) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
  });

  it("refuses when a leg's route is not in the bundle", () => {
    fs.rmSync(path.join(paths.dist, "data", "routes", "leg-one.json"));
    expect(() => stageAdventurePublication({ ...paths, id: "ridge-day", approval: "ridge-day" })).toThrow(/leg-one/);
  });

  it("refuses footage that no longer matches its imported digest", () => {
    fs.writeFileSync(path.join(paths.store, "ridge-day", "media", "clip-b.mp4"), "changed");
    expect(() => stageAdventurePublication({ ...paths, id: "ridge-day", approval: "ridge-day" })).toThrow(/clip-b/);
    expect(fs.existsSync(path.join(paths.dist, "adventures"))).toBe(false);
  });

  it("plans without copying on a dry run", () => {
    const manifest = stageAdventurePublication({ ...paths, id: "ridge-day", approval: "ridge-day", dryRun: true });
    expect(manifest.files).toHaveLength(5);
    expect(fs.existsSync(path.join(paths.dist, "adventures"))).toBe(false);
  });
});
