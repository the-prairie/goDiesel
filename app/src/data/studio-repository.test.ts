import { describe, expect, it } from "vitest";

import { parseRouteInbox, parseStagedRoute } from "@/data/studio-repository";

describe("staged route repository", () => {
  it("uses the production strict parser", () => {
    expect(() => parseStagedRoute({ slug: "unsafe" }, "unsafe")).toThrow("mid_idx");
  });
});

describe("route export inbox repository", () => {
  it("parses importable and visible unsupported exports", () => {
    expect(parseRouteInbox({
      roots: ["/Users/owner/Downloads"],
      entries: [
        {
          id: "a".repeat(24),
          filename: "Morning Run.gpx",
          source_format: "gpx",
          size_bytes: 397,
          modified_at: "2026-08-23T15:30:00Z",
          eligible: true,
          reason: null,
          imported: true,
          job_id: "job-existing",
          checksum_status: "checked",
        },
        {
          id: "b".repeat(24),
          filename: "original.fit.gz",
          source_format: "fit",
          size_bytes: 2048,
          modified_at: "2026-08-23T15:00:00Z",
          eligible: false,
          reason: "Route Studio needs a GPX export for FIT/FIT.GZ sources.",
          checksum_status: "checked",
        },
      ],
    })).toEqual({
      roots: ["/Users/owner/Downloads"],
      warnings: [],
      entries: [
        expect.objectContaining({
          filename: "Morning Run.gpx",
          eligible: true,
          imported: true,
          jobId: "job-existing",
          checksumStatus: "checked",
        }),
        expect.objectContaining({ sourceFormat: "fit", eligible: false }),
      ],
    });
  });

  it("preserves a deferred checksum as an unknown import state", () => {
    expect(parseRouteInbox({
      roots: ["/Users/owner/Downloads"],
      entries: [{
        id: "d".repeat(24), filename: "Large route.gpx", source_format: "gpx",
        size_bytes: 24_000_000, modified_at: "2026-08-23T15:30:00Z",
        eligible: true, reason: null, imported: false, job_id: null,
        checksum_status: "deferred",
      }],
    }).entries[0].checksumStatus).toBe("deferred");
  });

  it("rejects an unknown source format instead of presenting it as GPX", () => {
    expect(() => parseRouteInbox({
      roots: ["/Users/owner/Downloads"],
      entries: [{
        id: "c".repeat(24), filename: "route.zip", source_format: "zip",
        size_bytes: 12, modified_at: "2026-08-23T15:30:00Z",
        eligible: false, reason: "Unsupported.", imported: false, job_id: null,
      }],
    })).toThrow("source format");
  });
});
