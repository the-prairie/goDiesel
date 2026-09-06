import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readBuildIdentity } from "../../../../scripts/build-identity";

describe("build source identity", () => {
  it("embeds the real checkout rather than an unrelated declared CI SHA, and reports dirty source", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "godiesel-build-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
      mkdirSync(path.join(dir, "src")); writeFileSync(path.join(dir, "src/index.ts"), "export {};\n");
      git("add", "."); git("commit", "-m", "test");
      expect(readBuildIdentity(dir, "a".repeat(40))).toMatchObject({ source: "git", revision: git("rev-parse", "HEAD"), sourceState: "clean" });
      writeFileSync(path.join(dir, "src/new.ts"), "export {};\n");
      expect(readBuildIdentity(dir).sourceState).toBe("modified");
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });
  it("marks unverified source as unknown and rejects arbitrary environment strings", () => {
    expect(readBuildIdentity("/not-a-directory", "https://provider.invalid/?key=secret")).toMatchObject({ revision: null, source: "unavailable", sourceState: "unknown" });
    expect(readBuildIdentity("/not-a-directory", "a".repeat(40))).toMatchObject({ revision: "a".repeat(40), source: "environment", sourceState: "unknown" });
  });
});
