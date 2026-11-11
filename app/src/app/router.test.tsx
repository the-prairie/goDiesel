import { createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { productRouteTree } from "@/app/router";

const slug = "17654151284";

async function settledAt(path: string, from = "/finder") {
  const router = createMemoryRouter(productRouteTree, { initialEntries: [from] });
  await router.navigate(path);
  return router;
}

describe("product router", () => {
  it("canonicalizes a legacy quest path itself, after the app has started", async () => {
    const router = await settledAt(`/quest/${slug}`);

    expect(router.state.location.pathname).toBe(`/routes/${slug}`);
    // The legacy entry is replaced, so Back does not return to it.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("keeps a malformed legacy slug intact for the unavailable route state", async () => {
    const router = await settledAt("/quest/%");

    expect(router.state.location.pathname).toBe("/routes/%25");
  });

  it("still sends unknown paths to Atlas", async () => {
    const router = await settledAt("/not-a-surface");

    expect(router.state.matches.at(-1)?.route.path).toBe("*");
  });
});
