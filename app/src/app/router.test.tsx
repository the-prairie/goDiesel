import { createMemoryRouter, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { productRouteTree } from "@/app/router";

const slug = "17654151284";

async function settledAt(path: string, from = "/finder") {
  const router = createMemoryRouter(productRouteTree, { initialEntries: [from] });
  await router.navigate(path);
  return router;
}

function surfaceOf(router: Awaited<ReturnType<typeof settledAt>>) {
  return (router.state.matches.at(-1)?.route.handle as { surface?: string } | undefined)?.surface;
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

  it("shows a not-found page for an unknown path instead of redirecting to Atlas", async () => {
    const router = await settledAt("/finderr");

    expect(router.state.location.pathname).toBe("/finderr");
    expect(surfaceOf(router)).toBe("missing");
  });

  it("still opens Atlas from the root", async () => {
    const router = await settledAt("/");

    expect(router.state.matches.at(-1)?.route.index).toBe(true);
  });

  it("catches a view's errors inside the shell, so navigation stays usable", async () => {
    const router = await settledAt("/finder");
    const [shell, views] = router.state.matches.map((match) => match.route);

    // The shell keeps a last-resort boundary; the views' boundary sits under it.
    expect(shell?.errorElement).toBeTruthy();
    expect(views?.path).toBeUndefined();
    expect(views?.element).toBeUndefined();
    expect(views?.errorElement).toBeTruthy();
  });

  it("opens the Overland lab world and a route entry as labs", async () => {
    expect(surfaceOf(await settledAt("/lab/overland"))).toBe("lab");
    expect(surfaceOf(await settledAt(`/lab/overland/${slug}`))).toBe("lab");
  });

  it("names the surface of every view it can open", () => {
    const views = productRouteTree[0]?.children?.[0]?.children ?? [];
    const unnamed = views
      .filter((route: RouteObject) => route.element && !route.index)
      .filter((route) => !(route.handle as { surface?: string } | undefined)?.surface)
      .map((route) => route.path);

    expect(views.length).toBeGreaterThan(10);
    expect(unnamed).toEqual([]);
  });
});
