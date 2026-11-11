import { createMemoryRouter, type RouteObject } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sharedSlug = "17654151284";
const otherSlug = "17665674778";

let singleRouteTree: RouteObject[];

beforeEach(async () => {
  vi.stubEnv("VITE_SINGLE_ROUTE_SLUG", sharedSlug);
  vi.resetModules();
  ({ singleRouteTree } = await import("@/app/router.single"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function settledAt(path: string) {
  const router = createMemoryRouter(singleRouteTree, {
    initialEntries: [`/routes/${sharedSlug}`],
  });
  await router.navigate(path);
  return router;
}

describe("single-route microsite router", () => {
  it("canonicalizes a legacy link to the shared route to its guide", async () => {
    const router = await settledAt(`/quest/${sharedSlug}`);

    expect(router.state.location.pathname).toBe(`/routes/${sharedSlug}`);
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("sends a legacy link to any other route to the shared guide without naming it", async () => {
    const router = await settledAt(`/quest/${otherSlug}`);

    expect(router.state.location.pathname).toBe(`/routes/${sharedSlug}`);
    expect(router.state.location.pathname).not.toContain(otherSlug);
  });

  it("sends an unknown path to the shared guide, never to a product surface", async () => {
    const router = await settledAt("/finderr");

    expect(router.state.location.pathname).toBe(`/routes/${sharedSlug}`);
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("sends a malformed legacy link to the shared guide", async () => {
    const router = await settledAt("/quest/%");

    expect(router.state.location.pathname).toBe(`/routes/${sharedSlug}`);
  });
});
