import { describe, expect, it } from "vitest";

import { surfaceDocumentTitle, surfaceStatus, SURFACES } from "@/app/surface-placeholder";

describe("surface placeholder", () => {
  it("says which surface is opening", () => {
    expect(surfaceStatus("finder")).toBe("Opening Finder…");
    expect(surfaceStatus("routes")).toBe("Opening your routes…");
  });

  it("says the same as the route guide's own loading state, so the guide announces loading once", () => {
    // route-detail-page.tsx shows "Loading route details." while its data loads.
    expect(surfaceStatus("route")).toBe("Loading route details.");
  });

  it("never falls back to a generic loading message", () => {
    for (const surface of SURFACES) {
      expect(surfaceStatus(surface)).not.toMatch(/\bview\b/i);
    }
  });

  it("titles the document with the surface and the product name", () => {
    expect(surfaceDocumentTitle("atlas")).toBe("Atlas · goDiesel");
    expect(surfaceDocumentTitle("missing")).toBe("Page not found · goDiesel");
    expect(surfaceDocumentTitle(undefined)).toBe("goDiesel");
  });
});
