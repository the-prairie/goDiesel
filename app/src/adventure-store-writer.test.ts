import { describe, expect, it } from "vitest";

import { storeReadProblem, writerRequestProblem } from "../adventure-store.plugin";

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

describe("adventure store reads", () => {
  const read = (overrides: Partial<Parameters<typeof storeReadProblem>[0]> = {}) => ({
    remoteAddress: "127.0.0.1",
    host: "127.0.0.1:8789",
    relative: "final-boss/adventure.json",
    ...overrides,
  });

  it("serves the runtime's files to this machine", () => {
    for (const relative of ["index.json", "final-boss/adventure.json", "final-boss/media/clip.mp4", "final-boss/media/clip.jpg"]) {
      expect(storeReadProblem(read({ relative }))).toBeUndefined();
    }
    expect(storeReadProblem(read({ remoteAddress: "::1", host: "localhost:8789" }))).toBeUndefined();
  });

  it("refuses another machine on the network, even for the index", () => {
    expect(storeReadProblem(read({ remoteAddress: "192.168.4.20", relative: "index.json" }))).toMatch(/this machine/);
  });

  it("refuses a non-loopback Host (DNS rebinding)", () => {
    expect(storeReadProblem(read({ host: "192.168.4.34:8789" }))).toMatch(/host/i);
    expect(storeReadProblem(read({ host: "evil.test:8789" }))).toMatch(/host/i);
  });

  it("never serves import reports, publication plans or anything else in the store", () => {
    for (const relative of ["final-boss/import-report.json", "final-boss/publication-plan.json", "final-boss/notes.txt", "final-boss/media/../import-report.json", "final-boss/media/sub/clip.mp4"]) {
      expect(storeReadProblem(read({ relative }))).toMatch(/not served/);
    }
  });
});
