import { expect, test, type Page } from "@playwright/test";

async function installDirector(page: Page, deferredAudio: boolean | "reject" = false) {
  await page.addInitScript((deferred) => {
    const fixture = window as typeof window & {
      directorFixture: {
        audio: Array<() => void>;
        status: (state: "loading" | "ready" | "partial" | "unavailable") => void;
        destroys: number;
      };
    };
    fixture.directorFixture = { audio: [], status() {}, destroys: 0 };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      if (deferred === "reject") return Promise.reject(new Error("Audio start rejected."));
      if (!deferred) return resume.call(this);
      return new Promise<void>((resolve) => fixture.directorFixture.audio.push(resolve));
    };
    window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;background:#345058";
        container.replaceChildren(canvas);
        const credits = document.createElement("button");
        credits.textContent = "Provider information";
        credits.style.cssText = "position:absolute;bottom:0;right:0;height:24px";
        credits.onclick = () => { credits.textContent = "Provider information opened"; };
        container.append(credits);
        fixture.directorFixture.status = (state) => onStatus({ state, message: `Director fixture ${state}.` });
        fixture.directorFixture.status("ready");
      },
      setCamera() {},
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute() {},
      setRouteReveal() {},
      destroy() { fixture.directorFixture.destroys += 1; },
    });
  }, deferredAudio);
}

async function completeAudio(page: Page) {
  await page.evaluate(async () => {
    (window as typeof window & { directorFixture: { audio: Array<() => void> } }).directorFixture.audio.shift()?.();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function status(page: Page, next: "loading" | "ready" | "partial" | "unavailable") {
  await page.evaluate((state) => (window as typeof window & { directorFixture: { status(state: string): void } }).directorFixture.status(state), next);
}

async function seek(page: Page, value: string) {
  await page.getByRole("slider", { name: "Cinematic progress" }).fill(value);
}

async function open(page: Page, query = "") {
  await page.goto(`/#/lab/cinematic-director/14736711660${query}`);
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-state", "ready");
}

test("cut, playback, pause, seek, sound, decision, and restart retain their behavior", async ({ page }) => {
  await installDirector(page);
  await open(page);
  await page.getByRole("button", { name: "Kinetic A faster line" }).click();
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-cut", "kinetic");
  await page.getByRole("button", { name: "Play Kinetic" }).click();
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId("cinematic-director").getAttribute("data-frame-seconds"))).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause cinematic" }).click();
  await seek(page, "0.5");
  await expect(page.getByRole("button", { name: "Play cinematic" })).toBeVisible();
  await expect(page.getByRole("slider")).toHaveValue("0.5");
  await page.getByRole("button", { name: "Mute soundscape" }).click();
  await expect(page.getByRole("button", { name: "Enable soundscape" })).toBeVisible();
  await seek(page, "1");
  await expect(page.getByTestId("cinematic-decision")).toBeVisible();
  await page.getByRole("button", { name: "Another viewing" }).click();
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  await expect(page.getByTestId("cinematic-decision")).toHaveCount(0);
  await seek(page, "0.8");
  await page.getByRole("button", { name: "Play cinematic" }).click();
  await expect(page.getByRole("button", { name: "Play cinematic" })).toBeVisible();
  await expect(page.getByRole("slider")).toHaveValue("1");
});

test("a cut cancels a pending audio start", async ({ page }) => {
  await installDirector(page, true);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film" }).click();
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await page.getByRole("button", { name: "Intimate Closer" }).click();
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-cut", "intimate");
  await completeAudio(page);
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-frame-seconds", "0.000");
});

test("a newer seek cancels a pending audio start", async ({ page }) => {
  await installDirector(page, true);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film" }).click();
  await completeAudio(page);
  await page.getByRole("button", { name: "Pause cinematic" }).click();
  await seek(page, "0.25");
  await page.getByRole("button", { name: "Play cinematic" }).click();
  await seek(page, "0.75");
  await expect(page.getByRole("button", { name: "Play cinematic" })).toBeVisible();
  await completeAudio(page);
  await expect(page.getByRole("button", { name: "Play cinematic" })).toBeVisible();
  await expect(page.getByRole("slider")).toHaveValue("0.75");
});

test("provider status interrupts advancement and recovers retained playback intent", async ({ page }) => {
  await installDirector(page);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film" }).click();
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  await status(page, "unavailable");
  await expect(page.getByRole("alert")).toContainText("Director fixture unavailable.");
  const stopped = await page.getByTestId("cinematic-director").getAttribute("data-frame-seconds");
  await page.waitForTimeout(150);
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-frame-seconds", stopped!);
  await status(page, "partial");
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId("cinematic-director").getAttribute("data-frame-seconds"))).toBeGreaterThan(Number(stopped));
});

test("render-mode seek clamps finite input and ignores invalid input", async ({ page }) => {
  await installDirector(page);
  await open(page, "?render=1&cut=monumental");
  const director = page.getByTestId("cinematic-director");
  await expect(page.getByTestId("cinematic-preroll")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("godiesel:route-film-seek", { detail: { seconds: 12 } })));
  await expect(director).toHaveAttribute("data-frame-seconds", "12.000");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("godiesel:route-film-seek", { detail: { seconds: NaN } })));
  await expect(director).toHaveAttribute("data-frame-seconds", "12.000");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("godiesel:route-film-seek", { detail: { seconds: -5 } })));
  await expect(director).toHaveAttribute("data-frame-seconds", "0.000");
});

test("route replacement disposes the renderer and opens the new route paused", async ({ page }) => {
  await installDirector(page);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film" }).click();
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "/lab/cinematic-director/14023448720?cut=intimate"; });
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-cut", "intimate");
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { directorFixture: { destroys: number } }).directorFixture.destroys)).toBeGreaterThan(0);
});

test("rejected audio leaves playback paused and reports the existing error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installDirector(page, "reject");
  await open(page);
  await page.getByRole("button", { name: "Play Route Film", exact: true }).click();
  await expect.poll(() => errors).toContain("Audio start rejected.");
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-frame-seconds", "0.000");
});

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
  test(`all director cuts and Play remain reachable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installDirector(page);
    await open(page);
    const preroll = page.getByTestId("cinematic-preroll");
    await preroll.hover();
    await page.mouse.wheel(0, 900);
    const play = page.getByRole("button", { name: "Play Route Film", exact: true });
    await expect(play).toBeInViewport();
    await play.click();
    await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
  });
}

for (const state of ["loading", "unavailable"] as const) {
  test(`Back remains usable while the renderer is ${state}`, async ({ page }) => {
    await installDirector(page);
    await open(page);
    await status(page, state);
    await page.getByRole("link", { name: "Back to route intelligence" }).click({ timeout: 2_000 });
    await expect(page).toHaveURL(/#\/lab\/route-intelligence$/);
  });
}

test("only the newest audio start can begin playback", async ({ page }) => {
  await installDirector(page, true);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film", exact: true }).click();
  await page.getByRole("button", { name: "Play Route Film", exact: true }).click();
  await completeAudio(page);
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await completeAudio(page);
  await expect(page.getByRole("button", { name: "Pause cinematic" })).toBeVisible();
});

test("audio completion after route replacement does not start the new route", async ({ page }) => {
  await installDirector(page, true);
  await open(page);
  await page.getByRole("button", { name: "Play Route Film", exact: true }).click();
  await page.evaluate(() => { window.location.hash = "/lab/cinematic-director/14023448720"; });
  await expect(page.getByRole("region", { name: "Cinematic director for Crete, Greece" })).toBeVisible();
  await completeAudio(page);
  await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
  await expect(page.getByTestId("cinematic-director")).toHaveAttribute("data-frame-seconds", "0.000");
});

for (const viewport of [{ width: 320, height: 640 }, { width: 1280, height: 720 }]) {
  test(`provider footer remains usable through preroll and decision at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installDirector(page);
    await open(page);
    const credits = page.getByRole("button", { name: "Provider information", exact: true });
    await credits.click({ timeout: 2_000 });
    await expect(page.getByRole("button", { name: "Provider information opened" })).toBeVisible();
    await page.getByRole("button", { name: "Play Route Film", exact: true }).click();
    await seek(page, "1");
    await page.getByRole("button", { name: "Provider information opened" }).click({ timeout: 2_000 });
    const world = await page.getByTestId("cinematic-world").boundingBox();
    const playback = await page.getByRole("button", { name: "Play cinematic" }).boundingBox();
    expect(world!.y + world!.height).toBeLessThan(playback!.y);
  });
}
