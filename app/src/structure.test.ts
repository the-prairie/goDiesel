import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Structural guards for the app/src layout. The reorganization removed two
// import cycles and two layering violations; nothing else in the repository
// prevents them from coming back. See PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md
// and ADR-0008.

const SRC = path.resolve(__dirname);

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/["'](@\/[A-Za-z0-9_./-]+)["']/g)].map((match) => match[1]);
}

const files = sourceFiles(SRC)
  .filter((file) => !file.endsWith("structure.test.ts"))
  .map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  imports: importsOf(file),
}));

describe("app/src structure", () => {
  it("keeps production independent of labs (ADR-0008)", () => {
    const offenders = files
      // app/router.tsx is the composition root: it must reach every surface,
      // including the labs, to build the route table.
      .filter((file) => !file.rel.startsWith("labs/") && file.rel !== "app/router.tsx")
      .flatMap((file) =>
        file.imports
          .filter((specifier) => specifier.startsWith("@/labs/"))
          .map((specifier) => `${file.rel} -> ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps domain pure", () => {
    const forbidden = ["@/data/", "@/surfaces/", "@/labs/", "@/ui/", "@/providers/", "@/app/"];
    const offenders = files
      .filter((file) => file.rel.startsWith("domain/") && !file.rel.endsWith(".test.ts"))
      .flatMap((file) =>
        file.imports
          .filter((specifier) => forbidden.some((prefix) => specifier.startsWith(prefix)))
          .map((specifier) => `${file.rel} -> ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps one surface from importing another", () => {
    const offenders = files
      .filter((file) => file.rel.startsWith("surfaces/"))
      .flatMap((file) => {
        const surface = file.rel.split("/")[1];
        return file.imports
          .filter(
            (specifier) =>
              specifier.startsWith("@/surfaces/") &&
              specifier.split("/")[2] !== surface,
          )
          .map((specifier) => `${file.rel} -> ${specifier}`);
      });
    expect(offenders).toEqual([]);
  });
});
