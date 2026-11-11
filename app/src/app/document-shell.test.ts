import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

describe("index.html", () => {
  it("uses the product's canonical name, not legacy quest vocabulary", () => {
    expect(html).toMatch(/<title>goDiesel<\/title>/);
    expect(html).not.toMatch(/\bquest/i);
  });

  it("lets the safe-area insets reach the CSS", () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? "";

    expect(viewport.split(",").map((part) => part.trim())).toContain("viewport-fit=cover");
  });
});
