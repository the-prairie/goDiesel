import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/)?.[1] ?? "";

describe("index.html", () => {
  it("uses the product's canonical name, not legacy quest vocabulary", () => {
    expect(html).toMatch(/<title>goDiesel<\/title>/);
    expect(html).not.toMatch(/\bquest/i);
  });

  it("lets the safe-area insets reach the CSS", () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? "";

    expect(viewport.split(",").map((part) => part.trim())).toContain("viewport-fit=cover");
  });

  it("paints a static shell before the app's code has downloaded", () => {
    expect(root).toContain('data-static-shell');
    expect(root).toContain("goDiesel");
    // Primary navigation placeholders in their final positions.
    expect(root).toContain("static-shell-tabs");
    expect(root).toContain("static-shell-rail");
  });

  it("keeps the static shell self-contained", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    const inline = `${head.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ""}${root}`;

    expect(inline).not.toMatch(/https?:|url\(|@import|<img|<script/);
  });
});
