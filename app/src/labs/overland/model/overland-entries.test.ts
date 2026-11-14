import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { parseRouteSummary } from "@/domain/route";
import { buildOverlandEntries } from "@/labs/overland/model/overland-entries";

function summary(overrides: Record<string, unknown>) {
  return parseRouteSummary({
    slug: "1",
    activity_id: "1",
    lifecycle: "completed",
    name: "Somewhere",
    activity_name: "a run",
    region: "Calgary, AB",
    date: "2024-01-01",
    distance_km: 10,
    elevation_gain_m: 100,
    type: "Run",
    description: "",
    effort_tier: "Steady",
    trace: [[51, -114, 1000, 0], [51.01, -114.01, 1010, 1000]],
    replay: { mode: "atlas", replay_eligible: true, best_in_earth: false, geometry_status: "ready" },
    ...overrides,
  });
}

describe("buildOverlandEntries", () => {
  it("keeps her title exactly as written, emoji, repeated letters and trailing space included", () => {
    const [peach, gold, highwood] = buildOverlandEntries([
      summary({ slug: "a", activity_id: "a", activity_name: "🍑🍑🍑🍑💦💦💦💦", date: "2024-01-01" }),
      summary({ slug: "b", activity_id: "b", activity_name: "i love goooooooolddddddddd", date: "2024-01-02" }),
      summary({ slug: "c", activity_id: "c", activity_name: "high octane on the highwood ", date: "2024-01-03" }),
    ]);
    expect(peach.title).toBe("🍑🍑🍑🍑💦💦💦💦");
    expect(gold.title).toBe("i love goooooooolddddddddd");
    expect(highwood.title).toBe("high octane on the highwood ");
  });

  it("keeps her note verbatim, and has no note when the description is empty", () => {
    const [withNote, without] = buildOverlandEntries([
      summary({ slug: "a", activity_id: "a", description: "could not figure out how to cross the bridge 💀💀💀💀", date: "2024-01-01" }),
      summary({ slug: "b", activity_id: "b", description: "", date: "2024-01-02" }),
    ]);
    expect(withNote.note).toBe("could not figure out how to cross the bridge 💀💀💀💀");
    expect(without.note).toBeNull();
  });

  it("reads an unrecorded climb as unknown, never as zero", () => {
    const [recorded, flat, unknown] = buildOverlandEntries([
      summary({ slug: "a", activity_id: "a", elevation_gain_m: 286, date: "2024-01-01" }),
      summary({ slug: "b", activity_id: "b", elevation_gain_m: 0, date: "2024-01-02" }),
      summary({ slug: "c", activity_id: "c", elevation_gain_m: null, elevation_status: "unavailable", date: "2024-01-03" }),
    ]);
    expect(recorded.climbM).toBe(286);
    expect(flat.climbM).toBe(0);
    expect(unknown.climbM).toBeNull();
  });

  it("numbers routes by date, oldest first, breaking a shared date by activity id", () => {
    const entries = buildOverlandEntries([
      summary({ slug: "late", activity_id: "300", date: "2025-01-03" }),
      summary({ slug: "second", activity_id: "14130782031", date: "2025-01-02" }),
      summary({ slug: "first", activity_id: "14130772463", date: "2025-01-02" }),
      summary({ slug: "early", activity_id: "999", date: "2021-06-05" }),
    ]);
    expect(entries.map((entry) => [entry.number, entry.slug])).toEqual([
      [1, "early"],
      [2, "first"],
      [3, "second"],
      [4, "late"],
    ]);
  });

  it("gives the same numbers whatever order the routes arrive in", () => {
    const input = [
      summary({ slug: "x", activity_id: "2", date: "2024-05-01" }),
      summary({ slug: "y", activity_id: "1", date: "2024-05-01" }),
      summary({ slug: "z", activity_id: "3", date: "2023-05-01" }),
    ];
    const forward = buildOverlandEntries(input).map((entry) => entry.slug);
    const backward = buildOverlandEntries([...input].reverse()).map((entry) => entry.slug);
    expect(backward).toEqual(forward);
  });

  it("lists only completed routes", () => {
    const entries = buildOverlandEntries([
      summary({ slug: "done", activity_id: "1" }),
      summary({ slug: "found", activity_id: "2", lifecycle: "discovered" }),
      summary({ slug: "next", activity_id: "3", lifecycle: "planned" }),
    ]);
    expect(entries.map((entry) => entry.slug)).toEqual(["done"]);
  });

  it("names a ride a ride and everything else a run", () => {
    const [run, ride] = buildOverlandEntries([
      summary({ slug: "a", activity_id: "a", type: "Run", date: "2024-01-01" }),
      summary({ slug: "b", activity_id: "b", type: "Ride", date: "2024-01-02" }),
    ]);
    expect(run.kind).toBe("run");
    expect(ride.kind).toBe("ride");
  });

  it("carries place, date and distance through unchanged", () => {
    const [entry] = buildOverlandEntries([
      summary({ region: "Tokyo, Japan", date: "2025-11-26", distance_km: 21.8 }),
    ]);
    expect(entry).toMatchObject({ place: "Tokyo, Japan", date: "2025-11-26", km: 21.8 });
  });

  it("matches the bundled routes: one entry per completed route, numbered 1 to n", () => {
    const entries = buildOverlandEntries(routes);
    const completed = routes.filter((route) => route.lifecycle === "completed");
    expect(entries).toHaveLength(completed.length);
    expect(entries.map((entry) => entry.number)).toEqual(completed.map((_, index) => index + 1));
    for (const entry of entries) {
      const source = completed.find((route) => route.slug === entry.slug)!;
      expect(entry.title).toBe(source.activityName);
    }
  });
});
