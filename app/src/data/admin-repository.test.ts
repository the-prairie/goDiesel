import { afterEach, describe, expect, it, vi } from "vitest";

import { isLocalDevelopmentHost, loadAdminWorkspace } from "@/data/admin-repository";

describe("isLocalDevelopmentHost", () => {
  it.each([
    ["localhost", true],
    ["127.0.0.1", true],
    ["[::1]", true],
    ["::1", true],
    ["foo.localhost", true],
    ["LOCALHOST", true],
    ["godiesel.pages.dev", false],
    ["share-x.godiesel.pages.dev", false],
    // A LAN address is another device reaching the owner's machine; its own
    // loopback can never be the owner's loopback-only writer.
    ["192.168.1.5", false],
    ["10.0.0.4", false],
    ["localhost.example.com", false],
    ["notlocalhost", false],
    ["", false],
  ])("%s is local: %s", (hostname, expected) => {
    expect(isLocalDevelopmentHost(hostname)).toBe(expected);
  });
});

describe("loadAdminWorkspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["godiesel.pages.dev", "share-x.godiesel.pages.dev", "192.168.1.5"])(
    "makes no request and stays read-only when served from %s",
    async (hostname) => {
      const fetchSpy = vi.fn(async () => new Response("{}", { status: 503 }));
      vi.stubGlobal("fetch", fetchSpy);
      vi.stubGlobal("window", { setTimeout, clearTimeout });

      const workspace = await loadAdminWorkspace(hostname);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(workspace.mode).toBe("read-only");
      expect(workspace.routes.length).toBeGreaterThan(0);
    },
  );

  it("probes the loopback owner writer when served from a local origin", async () => {
    const fetchSpy = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/api/admin/status")
            ? {
                writer_available: true,
                generation_status: "ready",
                generated_at: null,
                checkout_root: "/somewhere",
                pid: 1,
                rebuild: { status: "idle" },
              }
            : [],
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const workspace = await loadAdminWorkspace("127.0.0.1");

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8766/api/admin/status",
      "http://127.0.0.1:8766/api/routes",
    ]);
    expect(workspace.mode).toBe("editable");
  });
});
