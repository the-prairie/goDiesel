import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROUTES = [
  { id: "tokyo-urban", slug: "17665674778" },
  { id: "banff-mountain", slug: "15573295095" },
  { id: "ucluelet-coastal", slug: "6496900063" },
] as const;

interface AttemptedRequest {
  method: string;
  origin: string;
  pathname: string;
  resourceType: string;
}

interface SurfaceEvidence {
  state: string;
  message: string;
  externalRequests: AttemptedRequest[];
  localRouteDetailLoaded: boolean;
  canvasCount: number;
}

function normalizedRequest(request: {
  method(): string;
  resourceType(): string;
  url(): string;
}): AttemptedRequest {
  const url = new URL(request.url());
  return {
    method: request.method(),
    origin: url.origin,
    pathname: url.pathname,
    resourceType: request.resourceType(),
  };
}

async function captureSurface(
  page: Page,
  path: string,
  slug: string,
  selector: string,
): Promise<SurfaceEvidence> {
  const externalRequests: AttemptedRequest[] = [];
  const localRequests: string[] = [];
  const listener = (request: Parameters<typeof normalizedRequest>[0]) => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:8796") {
      localRequests.push(url.pathname);
    } else if (url.protocol === "http:" || url.protocol === "https:") {
      externalRequests.push(normalizedRequest(request));
    }
  };
  page.on("request", listener);
  await page.goto("about:blank");
  await page.goto(path);
  const stage = page.locator(selector);
  await expect(stage).toBeVisible();
  await expect(stage).not.toHaveAttribute("data-state", "loading");
  const state = (await stage.getAttribute("data-state")) ?? "unknown";
  const message = ((await page.getByRole("alert").textContent().catch(() => "")) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const canvasCount = await stage.locator("canvas").count();
  page.off("request", listener);
  return {
    state,
    message,
    externalRequests: externalRequests
      .filter(
        (request, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.method === request.method &&
              candidate.origin === request.origin &&
              candidate.pathname === request.pathname &&
              candidate.resourceType === request.resourceType,
          ) === index,
      )
      .sort((left, right) =>
        `${left.origin}${left.pathname}`.localeCompare(`${right.origin}${right.pathname}`),
      ),
    localRouteDetailLoaded: localRequests.includes(`/data/routes/${slug}.json`),
    canvasCount,
  };
}

test("captures the provider-disabled reference-world baseline", async ({ page }) => {
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:8796") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });

  const routes = [];
  for (const route of ROUTES) {
    const playable = await captureSurface(
      page,
      `/#/lab/playable-earth/${route.slug}`,
      route.slug,
      'section[aria-label="Playable Earth Lab"]',
    );
    expect(playable.state).toBe("unavailable");
    expect(playable.message).toContain("Map tiles unavailable");
    expect(playable.localRouteDetailLoaded).toBe(true);
    expect(playable.externalRequests).toEqual([]);

    const replay = await captureSurface(
      page,
      `/#/replay/${route.slug}`,
      route.slug,
      'section[data-engine="google-3d-maps"]',
    );
    expect(replay.state).toBe("unavailable");
    expect(replay.message).toContain("A Google Maps JavaScript API browser key is required");
    expect(replay.localRouteDetailLoaded).toBe(true);
    expect(replay.externalRequests).toEqual([]);

    const atlas = await captureSurface(
      page,
      `/#/replay/${route.slug}?renderer=atlas`,
      route.slug,
      'section[data-engine="maplibre-atlas"]',
    );
    expect(atlas.localRouteDetailLoaded).toBe(true);
    expect(atlas.externalRequests.length).toBeGreaterThan(0);

    routes.push({ ...route, playable, replay, atlas });
  }

  const evidence = {
    schemaVersion: 1,
    capturedOn: "2026-08-26",
    conditions: {
      browser: "desktop-chromium",
      viewport: { width: 1440, height: 900 },
      liveGoogleProvidersDisabled: true,
      nonLocalNetworkRequests: "aborted",
      claim: "current-runtime-provider-dependency-baseline",
    },
    routes,
    conclusion: {
      playableEarthWorksOffline: false,
      defaultReplayWorksOffline: false,
      atlasReplayWorksOffline: false,
      reason:
        "Every current immersive path either requires a provider credential or attempts non-local map requests.",
    },
  };

  if (process.env.GODIESEL_CAPTURE_WORLD_PACK_BASELINE === "1") {
    const outputPath = path.resolve(
      process.cwd(),
      "../docs/world-packs/baseline/current-runtime-provider-disabled.json",
    );
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
});
