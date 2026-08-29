import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page, type Response, type TestInfo } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const adminPort = 8876;
const adminOrigin = `http://127.0.0.1:${adminPort}`;
const matrixSlugs = [
  "17654151284",
  "9934715694",
  "9845102380",
  "14736711660",
  "3519505225411091950",
] as const;
// Every top-level Python module, not a hand-kept subset.
//
// A fixed list silently rots: admin.py grew imports for curation_publish and
// route_media, which transitively need route_annotations and quest_meta, and
// the isolated workspace failed with ModuleNotFoundError at stage 3 of the live
// gate. Deriving the list means adding a module can never break this again.
// Test modules are excluded because the workspace only has to run the app.
async function adminWorkspaceFiles() {
  const entries = await readdir(repositoryRoot);
  const modules = entries.filter(
    (name) => name.endsWith(".py") && !name.startsWith("test_"),
  );
  return [...modules, "quests.json"];
}

interface ProviderObservation {
  category: string;
  contentType: string;
  responseBytes?: number;
  responseSha256?: string;
  requestSha256: string;
  sanitizedUrl: string;
  status: number;
}

interface NetworkFailure {
  error: string;
  requestSha256: string;
  sanitizedUrl: string;
}

function providerCategory(url: URL) {
  if (url.origin === adminOrigin) return "local-admin-api";
  if (url.origin === "http://127.0.0.1:8787" && url.pathname.includes("/data/routes/")) {
    return "generated-route-detail";
  }
  if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/staticmap") {
    return "google-static-maps";
  }
  if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/js") {
    return "google-maps-javascript";
  }
  if (url.hostname === "tile.googleapis.com" && url.pathname.endsWith("/root.json")) {
    return "google-photorealistic-root";
  }
  if (url.hostname === "tile.googleapis.com") return "google-photorealistic-content";
  if (url.hostname === "tiles.openfreemap.org" && url.pathname.startsWith("/styles/")) {
    return "openfreemap-style";
  }
  if (url.hostname === "tiles.openfreemap.org") return "openfreemap-content";
  if (url.hostname === "cesium.com" && url.pathname.includes("/cesiumjs/")) {
    return "cesium-runtime";
  }
  return undefined;
}

function sanitizedUrl(value: string) {
  const url = new URL(value);
  for (const key of [
    "center",
    "key",
    "lat",
    "location",
    "lon",
    "markers",
    "path",
    "signature",
    "token",
  ]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "<redacted>");
  }
  return url.toString();
}

function requestSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function startNetworkProof(page: Page) {
  const observations: ProviderObservation[] = [];
  const failures: NetworkFailure[] = [];
  const pending = new Set<Promise<void>>();
  const bodyCaptured = new Set<string>();

  page.on("response", (response: Response) => {
    const url = new URL(response.url());
    const category = providerCategory(url);
    if (!category) return;
    const task = (async () => {
      const headers = response.headers();
      const observation: ProviderObservation = {
        category,
        contentType: headers["content-type"] ?? "",
        requestSha256: requestSha256(response.url()),
        sanitizedUrl: sanitizedUrl(response.url()),
        status: response.status(),
      };
      const declaredLength = Number(headers["content-length"] ?? 0);
      if (!bodyCaptured.has(category) && declaredLength <= 8_000_000) {
        try {
          const body = await response.body();
          observation.responseBytes = body.length;
          observation.responseSha256 = createHash("sha256").update(body).digest("hex");
          bodyCaptured.add(category);
        } catch {
          // Streaming renderer responses can be released before Playwright reads them.
        }
      }
      observations.push(observation);
    })().finally(() => pending.delete(task));
    pending.add(task);
  });
  page.on("requestfailed", (request) => {
    const category = providerCategory(new URL(request.url()));
    if (!category) return;
    const error = request.failure()?.errorText ?? "unknown network failure";
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(error)) {
      failures.push({
        error,
        requestSha256: requestSha256(request.url()),
        sanitizedUrl: sanitizedUrl(request.url()),
      });
    }
  });

  return {
    async finish(testInfo: TestInfo) {
      while (pending.size > 0) await Promise.all([...pending]);
      const evidence = {
        observations: observations.sort((a, b) =>
          a.category.localeCompare(b.category) || a.sanitizedUrl.localeCompare(b.sanitizedUrl),
        ),
        failures,
      };
      await testInfo.attach("live-provider-responses", {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: "application/json",
      });
      return evidence;
    },
  };
}

async function routeRecord(slug: string) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, `app/public/data/routes/${slug}.json`), "utf8"),
  ) as {
    activity_name: string;
    lifecycle: "completed" | "planned" | "discovered";
    name: string;
    route: unknown[];
    subtitle: string;
  };
}

async function waitForAdmin() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (
      adminProcess &&
      (adminProcess.exitCode !== null || adminProcess.signalCode !== null)
    ) {
      throw new Error(
        `isolated real-data admin exited with ${adminProcess.exitCode ?? adminProcess.signalCode}: ${adminOutput}`,
      );
    }
    try {
      const response = await fetch(`${adminOrigin}/api/admin/status`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `isolated real-data admin did not start: ${String(lastError)}\n${adminOutput}`,
  );
}

async function oversizedRequestStatus() {
  return new Promise<number>((resolve, reject) => {
    const socket = connect(adminPort, "127.0.0.1");
    let response = "";
    let settled = false;
    const finish = (error?: Error, status?: number) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(status!);
    };
    socket.setTimeout(5_000, () => finish(new Error("oversized request timed out")));
    socket.on("error", (error) => finish(error));
    socket.on("connect", () => {
      socket.write([
        "POST /api/rebuild HTTP/1.1",
        `Host: 127.0.0.1:${adminPort}`,
        "Origin: http://127.0.0.1:8787",
        "Content-Length: 1048577",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response += String(chunk);
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(response)?.[1];
      if (status) finish(undefined, Number(status));
    });
    socket.on("end", () => {
      if (!settled) finish(new Error(`invalid oversized response: ${response}`));
    });
  });
}

let adminProcess: ChildProcess | undefined;
let adminWorkspace: string | undefined;
let adminExit: Promise<void> | undefined;
let adminOutput = "";

async function stopAdmin() {
  if (
    !adminProcess ||
    !adminExit ||
    adminProcess.exitCode !== null ||
    adminProcess.signalCode !== null
  ) return;
  adminProcess.kill("SIGTERM");
  const stopped = await Promise.race([
    adminExit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped && adminProcess.exitCode === null) {
    adminProcess.kill("SIGKILL");
    await adminExit;
  }
}

test.describe("real source to live provider pipeline", () => {
  test.beforeAll(async () => {
    adminWorkspace = await mkdtemp(path.join(tmpdir(), "godiesel-live-admin-"));
    for (const relative of await adminWorkspaceFiles()) {
      await cp(path.join(repositoryRoot, relative), path.join(adminWorkspace, relative));
    }
    await cp(path.join(repositoryRoot, "route_sources"), path.join(adminWorkspace, "route_sources"), {
      recursive: true,
    });
    await mkdir(path.join(adminWorkspace, "cards"));
    await mkdir(path.join(adminWorkspace, "app/src/data/generated"), { recursive: true });
    await mkdir(path.join(adminWorkspace, "app/public/data/routes"), { recursive: true });
    await cp(
      path.join(repositoryRoot, "app/src/data/generated/routes.manifest.json"),
      path.join(adminWorkspace, "app/src/data/generated/routes.manifest.json"),
    );
    adminProcess = spawn(path.join(repositoryRoot, ".venv/bin/python"), ["admin.py"], {
      cwd: adminWorkspace,
      env: {
        ...process.env,
        GODIESEL_ADMIN_PORT: String(adminPort),
        GODIESEL_APP_ORIGINS: "http://127.0.0.1:8787",
        GODIESEL_CHECKOUT_ROOT: adminWorkspace,
      },
      stdio: "pipe",
    });
    adminExit = new Promise((resolve) => adminProcess!.once("exit", () => resolve()));
    for (const stream of [adminProcess.stdout, adminProcess.stderr]) {
      stream?.on("data", (chunk) => {
        adminOutput = `${adminOutput}${String(chunk)}`.slice(-8_000);
      });
    }
    await waitForAdmin();
  });

  test.afterAll(async () => {
    await stopAdmin();
    if (adminWorkspace) await rm(adminWorkspace, { recursive: true, force: true });
  });

  test("loads the full real-route matrix and every external map provider", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const network = startNetworkProof(page);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.goto("/#/atlas?region=Kyoto%2C+Japan");
    const atlasWorld = page.locator('div[data-atlas-engine="cesium"]');
    await expect(atlasWorld).toHaveAttribute("data-atlas-status", "region-ready");
    const thumbnail = page.locator("[data-route-thumbnail]").first();
    await expect
      .poll(() => thumbnail.getAttribute("data-thumbnail-state"))
      .not.toBe("loading");
    const thumbnailState = await thumbnail.getAttribute("data-thumbnail-state");

    for (const slug of matrixSlugs) {
      const route = await routeRecord(slug);
      await page.goto(`/#/routes/${slug}`);
      const heading = route.lifecycle === "discovered" ? route.activity_name : route.name;
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      const geography = page.getByRole("region", { name: "Route geography" });
      await expect(geography).toHaveAttribute("data-map-status", "ready");
      await expect(geography).toHaveAttribute("data-geometry-points", String(route.route.length));
      await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
    }

    for (const slug of ["17654151284", "9934715694", "14736711660"]) {
      await page.goto(`/#/lab/google-route-navigator/${slug}`);
      const navigator = page.getByTestId("google-route-navigator");
      await expect(navigator).toHaveAttribute("data-state", "ready");
      await page.getByRole("button", { name: "Play route" }).click();
      await expect
        .poll(async () => Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0]))
        .toBeGreaterThan(0);
    }

    const evidence = await network.finish(testInfo);
    await testInfo.attach("static-thumbnail-state", {
      body: Buffer.from(JSON.stringify({ thumbnailState }, null, 2)),
      contentType: "application/json",
    });
    const categories = new Set(evidence.observations.map((entry) => entry.category));
    for (const expected of [
      "generated-route-detail",
      "google-maps-javascript",
      "google-photorealistic-content",
      "google-photorealistic-root",
      "google-static-maps",
      "openfreemap-content",
      "openfreemap-style",
    ]) {
      expect(categories, `missing live response evidence for ${expected}`).toContain(expected);
    }
    expect(evidence.observations.filter((entry) => entry.status >= 400)).toEqual([]);
    for (const expected of categories) {
      const captured = evidence.observations.find(
        (entry) => entry.category === expected && entry.responseBytes && entry.responseSha256,
      );
      expect(captured, `missing non-empty response body evidence for ${expected}`).toBeTruthy();
      expect(captured?.contentType, `missing response type evidence for ${expected}`).not.toBe("");
    }
    expect(evidence.failures).toEqual([]);
    expect(thumbnailState).toBe("loaded");
    expect(runtimeErrors).toEqual([]);
  });

  test("saves real reviewed curation through the isolated owner writer and rebuilds all routes", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const crossOriginResponse = await fetch(`${adminOrigin}/api/rebuild`, {
      method: "POST",
      headers: { Origin: "https://attacker.invalid" },
    });
    expect(crossOriginResponse.status).toBe(403);
    expect(await oversizedRequestStatus()).toBe(413);
    const malformedResponse = await fetch(`${adminOrigin}/api/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8787",
      },
      body: "{",
    });
    expect(malformedResponse.status).toBe(400);
    expect((await fetch(`${adminOrigin}/api/admin/status`)).ok).toBe(true);

    const network = startNetworkProof(page);
    await page.goto("/#/admin");
    await expect(page.getByText("Local owner writer connected.")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search owner routes" });
    await search.fill("Kyoto, Japan");
    const reviewedRoute = page
      .getByRole("complementary", { name: "Owner route list" })
      .getByRole("button")
      .filter({ hasText: "reviewed" });
    await expect(reviewedRoute).toHaveCount(1);
    await reviewedRoute.click();

    const vibe = page.getByLabel("Vibe");
    const realValue = await vibe.inputValue();
    expect(realValue.length).toBeGreaterThan(20);
    await vibe.fill(`${realValue} `);
    await page.getByRole("button", { name: "Save and regenerate" }).click();
    await expect(page.getByText("Saved. Manifest and route detail regenerated.")).toBeVisible();

    const response = await fetch(`${adminOrigin}/api/routes`);
    expect(response.ok).toBe(true);
    const routes = (await response.json()) as Array<{
      activity_id: string;
      curation: { review_status: string; vibe: string };
      generation_status: string;
    }>;
    const saved = routes.find((route) => route.activity_id === "17654151284");
    expect(saved).toMatchObject({
      curation: { review_status: "reviewed", vibe: realValue },
      generation_status: "ready",
    });

    const generated = JSON.parse(
      await readFile(
        path.join(adminWorkspace!, "app/public/data/routes/17654151284.json"),
        "utf8",
      ),
    ) as { curation: { vibe: string }; route: unknown[] };
    expect(generated.curation.vibe).toBe(realValue);
    expect(generated.route.length).toBeGreaterThan(100);
    expect((await readFile(path.join(adminWorkspace!, "app/src/data/quests.generated.json"))).length).toBeGreaterThan(
      1_000_000,
    );

    const evidence = await network.finish(testInfo);
    expect(new Set(evidence.observations.map((entry) => entry.category))).toContain(
      "local-admin-api",
    );
    expect(evidence.observations.filter((entry) => entry.status >= 400)).toEqual([]);
    await writeFile(
      testInfo.outputPath("isolated-admin-proof.json"),
      JSON.stringify(
        {
          generatedRoutePoints: generated.route.length,
          realCurationSha256: createHash("sha256").update(realValue).digest("hex"),
          workspace: "isolated temporary copy of the complete real route library",
        },
        null,
        2,
      ),
    );
  });
});
