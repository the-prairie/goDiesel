import { execFileSync } from "node:child_process";
import type { WorldBuildIdentity } from "../src/surfaces/replay/world/world-diagnostics";

/** The checked-out source wins over CI's merge SHA. Embed no arbitrary environment text. */
export function readBuildIdentity(cwd: string, declaredRevision?: string): WorldBuildIdentity {
  const builtAt = new Date().toISOString();
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Invalid Git revision");
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", "src", "scripts", "public", "vite.config.ts", "package.json", "package-lock.json"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { revision, source: "git", sourceState: dirty ? "modified" : "clean", builtAt };
  } catch {
    const revision = declaredRevision && /^[a-f0-9]{40}$/i.test(declaredRevision) ? declaredRevision : null;
    return { revision, source: revision ? "environment" : "unavailable", sourceState: "unknown", builtAt };
  }
}
