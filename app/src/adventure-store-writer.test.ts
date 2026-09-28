import { describe, expect, it } from "vitest";

import { writerRequestProblem } from "../adventure-store.plugin";

const request = (overrides: Partial<Parameters<typeof writerRequestProblem>[0]> = {}) => ({
  method: "PUT",
  remoteAddress: "127.0.0.1",
  host: "localhost:8787",
  origin: "http://localhost:8787",
  contentType: "application/json",
  ...overrides,
});

describe("adventure writer guard", () => {
  it("accepts a same-origin JSON write from this machine", () => {
    expect(writerRequestProblem(request())).toBeUndefined();
    expect(writerRequestProblem(request({ remoteAddress: "::ffff:127.0.0.1" }))).toBeUndefined();
  });

  it("refuses another machine on the network", () => {
    expect(writerRequestProblem(request({ remoteAddress: "192.168.1.20" }))).toMatch(/this machine/);
  });

  it("refuses a page from another origin, even on this machine", () => {
    expect(writerRequestProblem(request({ origin: "https://example.com" }))).toMatch(/origin/);
    expect(writerRequestProblem(request({ origin: undefined }))).toMatch(/origin/);
  });

  it("refuses a request whose Host is not loopback (DNS rebinding)", () => {
    expect(writerRequestProblem(request({ host: "evil.test:8787", origin: "http://evil.test:8787" }))).toMatch(/host/i);
  });

  it("refuses anything but a JSON PUT", () => {
    expect(writerRequestProblem(request({ method: "POST" }))).toMatch(/PUT/);
    expect(writerRequestProblem(request({ contentType: "text/plain" }))).toMatch(/JSON/);
  });
});
