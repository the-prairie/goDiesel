#!/usr/bin/env node

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [publicUrl, routeSlug] = process.argv.slice(2);
if (!publicUrl || !routeSlug) {
  throw new Error("Usage: smoke-single-route-microsite.mjs <url> <route-slug>");
}

const route = JSON.parse(
  fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      `../public/data/routes/${routeSlug}.json`,
    ),
    "utf8",
  ),
);
const routeTitle = route.subtitle || route.activity_name || route.name;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await page.goto(publicUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page
        .getByRole("heading", { name: routeTitle })
        .waitFor({ timeout: 15_000 });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(attempt * 1_000);
    }
  }
  if (lastError) throw lastError;

  if (!page.url().includes(`#/routes/${routeSlug}`)) {
    throw new Error(`public root did not resolve to route ${routeSlug}`);
  }
  if ((await page.getByTestId("atlas-spine").count()) > 0) {
    throw new Error("desktop product navigation is visible");
  }

  await page.getByRole("link", { name: "Open replay" }).click();
  await page.getByRole("button", { name: "Route guide" }).waitFor();
  if ((await page.getByText("Change route", { exact: true }).count()) > 0) {
    throw new Error("route switching is available in the public replay");
  }

  console.log(`Public smoke passed: ${publicUrl}`);
} finally {
  await browser.close();
}
