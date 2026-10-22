import { expect, test, type Page } from "@playwright/test";
import { installGoogleReplay } from "./helpers/google-replay";
const key = "godiesel.replay-marker.v1";
const courseId = "course-213a0076-6d18-5be9-9fb2-7a772888c6b5";

async function photoFile(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#557f91";
    ctx.fillRect(0, 0, 480, 320);
    ctx.fillStyle = "#db9a76";
    ctx.beginPath();
    ctx.ellipse(240, 135, 70, 85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#20242e";
    ctx.beginPath();
    ctx.ellipse(240, 320, 125, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#292526";
    ctx.fillRect(215, 125, 9, 9);
    ctx.fillRect(256, 125, 9, 9);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "test-portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}
async function upload(page: Page, name = "Upload photo") {
  const file = await photoFile(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name, exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByLabel("Circular marker crop preview")).toBeVisible();
}
async function installCourse(page: Page) {
  await page.route(`**/api/courses?id=${courseId}`, (route) =>
    route.fulfill({
      json: {
        course: {
          id: courseId,
          name: "Marker test course",
          description: "",
          activity: "Run",
          createdAt: "2026-10-21T07:00:00Z",
          source: { kind: "gpx", filename: "marker.gpx" },
          warnings: [],
          segments: [
            [
              { lat: 51, lng: -114, elevationM: 1050 },
              { lat: 51.01, lng: -114, elevationM: 1060 },
            ],
          ],
        },
      },
    }),
  );
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`crops and remembers the same marker across replay and course preview at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installGoogleReplay(page, "ready");
    await installCourse(page);
    await page.goto("/#/replay/14736711660");
    await page
      .getByRole("button", { name: "Replay settings", exact: true })
      .click();
    await upload(page);
    await page.getByRole("slider", { name: "Zoom photo" }).fill("1.6");
    await page.getByRole("slider", { name: "Horizontal position" }).fill("0.3");
    await page.getByRole("slider", { name: "Vertical position" }).fill("0.6");
    const crop = page.getByLabel("Circular marker crop preview");
    const box = await crop.boundingBox();
    await page.mouse.move(box!.x + 80, box!.y + 80);
    await page.mouse.down();
    await page.mouse.move(box!.x + 95, box!.y + 70);
    await page.mouse.up();
    expect(
      Number(
        await page
          .getByRole("slider", { name: "Horizontal position" })
          .inputValue(),
      ),
    ).toBeLessThan(0.3);
    await page.getByRole("button", { name: "Use photo", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "Photo", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Change photo", exact: true }),
    ).toBeFocused();
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      key,
    );
    expect(saved.photo).toMatch(/^data:image\/jpeg;base64,/);
    expect(saved.photo.length).toBeLessThan(200000);
    await expect(page.getByAltText("Your saved marker")).toBeVisible();
    await upload(page, "Change photo");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).photo,
        key,
      ),
    ).toBe(saved.photo);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`/#/courses/${courseId}/preview`);
    await page
      .getByRole("button", { name: "Preview settings", exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: "Photo", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "Dot", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "Dot", exact: true }),
    ).toBeChecked();
    await page.reload();
    await page
      .getByRole("button", { name: "Preview settings", exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: "Dot", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "Photo", exact: true }).click();
    await expect(page.getByAltText("Your saved marker")).toHaveAttribute(
      "src",
      saved.photo,
    );
    await page
      .getByRole("button", { name: "Remove photo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Upload photo", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    ).toEqual({ version: 1, kind: "dot" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("rejects unreadable photos and preserves the crop when storage fails", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  await page
    .getByRole("button", { name: "Replay settings", exact: true })
    .click();
  await page
    .getByLabel("Upload marker photo")
    .setInputFiles({
      name: "bad.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a picture"),
    });
  await expect(page.getByRole("alert")).toContainText("could not be opened");
  await upload(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "godiesel.replay-marker.v1")
        throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not save the marker",
  );
  await expect(page.getByLabel("Circular marker crop preview")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Upload photo", exact: true }),
  ).toBeFocused();
});

test("marker editing stays available while the map is loading", async ({
  page,
}) => {
  await installGoogleReplay(page, "loading");
  await page.goto("/#/replay/14736711660");
  await page
    .getByRole("button", { name: "Replay settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await upload(page);
  await page.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Photo", exact: true }),
  ).toBeChecked();
});

test("closing settings discards an unsaved crop", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  await page
    .getByRole("button", { name: "Replay settings", exact: true })
    .click();
  await upload(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Replay settings", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Replay settings", exact: true })
    .click();
  await expect(page.getByLabel("Circular marker crop preview")).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});
