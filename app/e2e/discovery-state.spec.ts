import { expect, test, type Route } from "@playwright/test";

const discoveryUrl = "/#/finder?activity=Run&distance=0&scope=new&near=Springfield";
const places = [
  { name: "Springfield, Illinois", lat: 39.8, lng: -89.6 },
  { name: "Springfield, Massachusetts", lat: 42.1, lng: -72.6 },
];
const candidate = {
  id: "osm-123",
  name: "River path",
  sourceUrl: "https://www.openstreetmap.org/relation/123",
  activity: "Run",
  distanceKm: 4,
  distanceKind: "mapped",
  lines: [[[0, 50], [0.01, 50]]],
};

test("discovery requires an explicit place choice and clears choices on edit", async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/discovery?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return route.fulfill({ json: params.has("place")
      ? { places: [places[0], { ...places[0], lat: 40 }, places[1]] }
      : { routes: [candidate] } });
  });
  await page.goto(discoveryUrl);
  const destination = page.getByRole("textbox", { name: "Near where?" });
  await destination.fill("   ");
  await expect(page.getByRole("button", { name: "Search new routes", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await destination.fill(" Springfield ");
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await expect(page.getByRole("button", { name: places[0].name, exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: places[1].name, exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].get("place")).toBe("Springfield");
  await expect(page).toHaveURL(/near=Springfield/);
  await destination.fill("Springfield again");
  await expect(page.getByRole("button", { name: places[0].name, exact: true })).toHaveCount(0);
  await expect(page.getByText("Choose the place you mean.", { exact: true })).toBeVisible();
  await destination.fill("Springfield");
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await page.getByRole("button", { name: places[1].name, exact: true }).click();
  await expect(page.getByRole("article", { name: candidate.name, exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[2].get("lat")).toBe("42.1");
  expect(requests[2].get("lng")).toBe("-72.6");
  expect(requests[2].get("activity")).toBe("Run");
});

test("editing a pending destination does not cancel or impose a client deadline", async ({ page }) => {
  let pending: Route | undefined;
  await page.route("**/api/discovery?**", (route) => { pending = route; });
  await page.goto(discoveryUrl);
  await page.clock.install();
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole("textbox", { name: "Near where?" }).fill("Changed while waiting");
  await page.clock.fastForward(120_000);
  await expect(page.getByRole("button", { name: "Searching…", exact: true })).toBeDisabled();
  await pending!.fulfill({ json: { places: [places[0]] } });
  await expect(page.getByRole("button", { name: places[0].name, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Near where?" })).toHaveValue("Changed while waiting");
  await expect(page).toHaveURL(/near=Springfield/);
});

for (const width of [390, 1280]) {
  test(`known-place discovery preserves selection, view and save feedback at ${width}px`, async ({ page }) => {
    const requests: URLSearchParams[] = [];
    await page.route("**/api/discovery?**", (route) => {
      requests.push(new URL(route.request().url()).searchParams);
      return route.fulfill({ json: { routes: [candidate, {
        ...candidate, id: "osm-124", name: "Woodland path", distanceKm: 6,
        sourceUrl: "https://www.openstreetmap.org/relation/124",
      }] } });
    });
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/finder?place=Kyoto&activity=Run&distance=0&scope=new");
    await page.getByRole("button", { name: "Search new routes", exact: true }).click();
    const second = page.getByRole("article", { name: "Woodland path", exact: true });
    await expect(second).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].has("place")).toBe(false);
    expect(requests[0].has("lat")).toBe(true);
    await second.getByRole("button", { name: "Preview route", exact: true }).click();
    await expect(page.getByLabel("Selected map route")).toContainText("Woodland path");
    if (width < 1024) {
      await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "List", exact: true }).click();
    }
    await second.getByRole("button", { name: "Save as planned", exact: true }).click();
    await expect(second.getByRole("status")).toHaveText("Saved on this device.");
    await page.getByRole("textbox", { name: "Near where?" }).fill("Draft destination");
    await expect(second).toBeVisible();
    await expect(second.getByRole("button", { name: "On map", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Near where?" }).fill("Kyoto");
    await page.getByRole("button", { name: "Search again", exact: true }).click();
    await expect(page.getByRole("article", { name: "River path", exact: true })
      .getByRole("button", { name: "On map", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(second.getByRole("status")).toHaveText("Saved on this device.");
    if (width < 1024) {
      await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/discovery-state/results-${width}.png` });
  });
}

test("no-place and empty-route outcomes preserve the current empty messages", async ({ page }) => {
  await page.route("**/api/discovery?**", (route) => route.fulfill({ json: { places: [] } }));
  await page.goto(discoveryUrl);
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await expect(page.getByText("No places found. Try a town or region name.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No mapped routes match these filters" })).toBeVisible();
  await page.getByRole("textbox", { name: "Near where?" }).fill("Kyoto");
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No mapped routes match these filters" })).toBeVisible();
  await expect(page.getByText("No places found. Try a town or region name.", { exact: true })).toHaveCount(0);
});

for (const failure of ["upstream", "host", "network"] as const) {
  test(`discovery preserves ${failure} failure and retry with the edited destination`, async ({ page }) => {
    let attempts = 0;
    let retriedPlace: string | null = null;
    await page.route("**/api/discovery?**", (route) => {
      attempts += 1;
      if (attempts > 1) {
        retriedPlace = new URL(route.request().url()).searchParams.get("place");
        return route.fulfill({ json: { places: [places[0]] } });
      }
      if (failure === "network") return route.abort("failed");
      if (failure === "host") return route.fulfill({ contentType: "text/html", body: "Unavailable" });
      return route.fulfill({ status: 504, json: { error: "Upstream timed out. Try again." } });
    });
    await page.goto(discoveryUrl);
    await page.getByRole("button", { name: "Search new routes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    if (failure === "upstream") await expect(page.getByRole("status")).toContainText("Upstream timed out. Try again.");
    if (failure === "host") await expect(page.getByRole("status")).toContainText("New-route discovery is not available on this host.");
    await page.getByRole("textbox", { name: "Near where?" }).fill("New destination");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("button", { name: places[0].name, exact: true })).toBeVisible();
    expect(retriedPlace).toBe("New destination");
  });
}

test("retry after a chosen-place failure resolves the unchanged destination again", async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/discovery?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return params.has("place")
      ? route.fulfill({ json: { places } })
      : route.fulfill({ status: 504, json: { error: "Route lookup timed out." } });
  });
  await page.goto(discoveryUrl);
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
  await page.getByRole("button", { name: places[1].name, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Route lookup timed out.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: places[0].name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: places[1].name, exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[1].get("lat")).toBe("42.1");
  expect(requests[2].get("place")).toBe("Springfield");
  expect(requests[2].has("lat")).toBe(false);
});

for (const boundary of ["scope", "submitted filters"] as const) {
  test(`changing ${boundary} cancels discovery and keeps late results out of the new session`, async ({ page }) => {
    let pending: Route | undefined;
    let failedRequest = false;
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/discovery?")) failedRequest = true;
    });
    await page.route("**/api/discovery?**", (route) => {
      if (!pending) pending = route;
      else return route.fulfill({ json: { routes: [{ ...candidate, distanceKm: 10 }] } });
    });
    await page.goto("/#/finder?place=Kyoto&activity=Run&distance=0&scope=new");
    await page.getByRole("button", { name: "Search new routes", exact: true }).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    if (boundary === "scope") {
      await page.getByRole("button", { name: /^My collection/ }).click();
      await page.getByRole("button", { name: "Discover new routes", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Edit distance target", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Distance km", exact: true }).fill("10");
      await page.getByRole("button", { name: "Find routes", exact: true }).click();
    }
    await expect.poll(() => failedRequest).toBe(true);
    await expect(page.getByRole("button", { name: "Search new routes", exact: true })).toBeEnabled();
    await pending!.fulfill({ json: { routes: [{ ...candidate, distanceKm: 10, name: "Obsolete route" }] } });
    await page.getByRole("button", { name: "Search new routes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Searching…", exact: true })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Obsolete route", exact: true })).toHaveCount(0);
    await expect(page.getByRole("article", { name: candidate.name, exact: true })).toBeVisible();
  });
}
