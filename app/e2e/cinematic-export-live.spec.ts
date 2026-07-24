import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test("exports a playable photorealistic route-film master", async () => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );
  test.setTimeout(120_000);

  const directory = await mkdtemp(join(tmpdir(), "godiesel-route-film-"));
  const output = join(directory, "proof.mp4");
  const baseUrl =
    process.env.GODIESEL_ATLAS_PREVIEW_URL ?? "http://127.0.0.1:8787";

  try {
    const result = await runExporter([
      "--route=14023448720",
      `--base-url=${baseUrl}`,
      "--width=1280",
      "--height=720",
      "--fps=1",
      "--motion-samples=1",
      "--spatial-scale=1.5",
      "--max-seconds=1",
      "--preflight=false",
      `--output=${output}`,
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect((await stat(output)).size).toBeGreaterThan(20_000);
    const header = await readFile(output);
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function runExporter(arguments_: string[]) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      ["scripts/render-route-film.mjs", ...arguments_],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => resolve({ code, stderr }));
  });
}
