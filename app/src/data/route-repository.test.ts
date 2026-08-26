import { afterEach, describe, expect, it, vi } from "vitest";

import { loadRouteDetail } from "@/data/route-repository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadRouteDetail", () => {
  it("retries transient request failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadRouteDetail("retry-route")).resolves.toEqual({
      status: "error",
      message: "Route data could not be loaded.",
    });
    await expect(loadRouteDetail("retry-route")).resolves.toEqual({ status: "not-found" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
