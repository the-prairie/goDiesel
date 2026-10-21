import { describe, expect, it } from "vitest";

import {
  COURSE_MAX_GPX_BYTES,
  courseGpx,
  courseStats,
  importCourseGpx,
  parseCourse,
  parseCourseRequest,
  questRouteGpx,
  type CourseRequest,
} from "@/domain/courses";
import type { QuestRoute } from "@/domain/route";

const options = {
  id: "course-fdd510ea-d5a8-4678-9f1a-005f5c12f100",
  createdAt: "2026-10-21T12:00:00Z",
  filename: "morning.gpx",
  activity: "Run" as const,
};

const request: CourseRequest = {
  start: { lat: 37.77, lng: -122.42, name: "San Francisco" },
  distance: 10,
  unit: "km",
  activity: "Run",
  vibes: ["quiet", "green"],
  seed: 0,
};

function gpx(points = '<trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/>') {
  return `<gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;
}

describe("course request boundary", () => {
  it.each(["Run", "Walk", "Ride"])("accepts %s and preserves the requested unit and variation", (activity) => {
    expect(parseCourseRequest({ ...request, activity, unit: "mi", seed: 42 })).toEqual({
      ...request, activity, unit: "mi", seed: 42,
    });
  });

  it("applies the distance limit in kilometers even when miles are requested", () => {
    expect(parseCourseRequest({ ...request, distance: 124, unit: "mi" }).distance).toBe(124);
    expect(() => parseCourseRequest({ ...request, distance: 125, unit: "mi" })).toThrow(/distance/i);
    expect(() => parseCourseRequest({ ...request, distance: 0.5, unit: "mi" })).toThrow(/distance/i);
    expect(parseCourseRequest({ ...request, distance: 0.7, unit: "mi" }).distance).toBe(0.7);
    expect(parseCourseRequest({ ...request, distance: 200 }).distance).toBe(200);
  });

  it.each([
    { vibes: ["safe"] }, { vibes: "quiet" }, { activity: "Ski" },
    { distance: "10" }, { distance: NaN }, { seed: 0.5 }, { seed: -1 },
    { start: { lat: 91, lng: 0, name: "Bad" } },
    { start: { lat: 0, lng: Infinity, name: "Bad" } },
  ])("rejects unsupported or malformed request fields %j", (fields) => {
    expect(() => parseCourseRequest({ ...request, ...fields })).toThrow();
  });

  it("normalizes duplicate known vibes without creating extra routing preferences", () => {
    expect(parseCourseRequest({ ...request, vibes: ["green", "green"] }).vibes).toEqual(["green"]);
  });
});

describe("GPX course import and export", () => {
  it("round trips names, descriptions, positions, partial elevation and recorded timestamps", () => {
    const course = importCourseGpx(`<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1">
      <g:metadata><g:name>Bay &amp; Ocean &lt;loop&gt;</g:name><g:desc>Café &quot;coast&quot; &apos;path&apos;</g:desc></g:metadata>
      <g:trk><g:trkseg>
        <g:trkpt lat="37.77" lon="-122.42"><g:ele>-2.5</g:ele><g:time>2026-10-20T11:22:33.125-07:00</g:time></g:trkpt>
        <g:trkpt lat="37.771" lon="-122.421"><g:time>2026-10-20T11:23:34Z</g:time></g:trkpt>
        <g:trkpt lat="37.772" lon="-122.422"><g:ele>12</g:ele></g:trkpt>
      </g:trkseg></g:trk>
    </g:gpx>`, options);
    expect(course.name).toBe("Bay & Ocean <loop>");
    expect(course.description).toBe('Café "coast" \'path\'');
    expect(course.segments[0]).toEqual([
      { lat: 37.77, lng: -122.42, elevationM: -2.5, time: "2026-10-20T11:22:33.125-07:00" },
      { lat: 37.771, lng: -122.421, time: "2026-10-20T11:23:34Z" },
      { lat: 37.772, lng: -122.422, elevationM: 12 },
    ]);
    expect(course.ascentM).toBeNull();
    expect(course).not.toHaveProperty("elapsedS");
    expect(course).not.toHaveProperty("lifecycle");
    const exported = courseGpx(course);
    expect(exported).toContain("Bay &amp; Ocean &lt;loop&gt;");
    expect(exported).toContain("Café &quot;coast&quot; &apos;path&apos;");
    const importedAgain = importCourseGpx(exported, options);
    expect(importedAgain.segments).toEqual(course.segments);
    expect(importedAgain.name).toBe(course.name);
    expect(importedAgain.description).toBe(course.description);
  });

  it("keeps every track and route segment in file order and never counts a connecting gap", () => {
    const course = importCourseGpx(`<gpx>
      <trk><name>Coast</name><trkseg><trkpt lat="0" lon="0"><ele>0</ele></trkpt><trkpt lat="0" lon="0.001"><ele>10</ele></trkpt></trkseg></trk>
      <rte><rtept lat="0" lon="100"><ele>500</ele></rtept><rtept lat="0" lon="100.001"><ele>505</ele></rtept></rte>
      <trk><trkseg><trkpt lat="0" lon="50"><ele>900</ele></trkpt><trkpt lat="0" lon="50.001"><ele>890</ele></trkpt></trkseg></trk>
    </gpx>`, options);
    expect(course.segments.map((segment) => segment[0].lng)).toEqual([0, 100, 50]);
    expect(course.distanceM).toBeCloseTo(333.5848, 2);
    expect(course.ascentM).toBe(15);
    expect(importCourseGpx(courseGpx(course), options).segments).toEqual(course.segments);
  });

  it("imports route waypoints without inventing time or elevation", () => {
    const course = importCourseGpx('<gpx><rte><name>Waterfront</name><rtept lat="0" lon="0"/><rtept lat="0" lon="0.001"/></rte></gpx>', options);
    expect(course.name).toBe("Waterfront");
    expect(course.segments).toEqual([[{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }]]);
    expect(course.ascentM).toBeNull();
    expect(courseGpx(course)).not.toContain("<time>");
    expect(courseGpx(course)).not.toContain("<ele>");
  });

  it("accepts CDATA text and standard numeric entities without treating them as markup", () => {
    const course = importCourseGpx(`<gpx><metadata><name><![CDATA[Bay & rocks <morning>]]></name><desc>Caf&#233; &#x1f6b2;</desc></metadata><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon=".001"/></trkseg></trk></gpx>`, options);
    expect(course.name).toBe("Bay & rocks <morning>");
    expect(course.description).toBe("Café 🚲");
  });

  it("exports tiny decimal coordinates without exponent notation or precision loss", () => {
    const course = importCourseGpx(gpx('<trkpt lat="0.000000123456789" lon="-0.000000001"/><trkpt lat="0" lon="0.001"/>'), options);
    const exported = courseGpx(course);
    expect(exported).toContain('lat="0.000000123456789" lon="-0.000000001"');
    expect(importCourseGpx(exported, options).segments).toEqual(course.segments);
  });

  it("does not decode escaped entity text twice", () => {
    const course = importCourseGpx(gpx(), { ...options, name: "Literal &#233; &amp;" });
    expect(importCourseGpx(courseGpx(course), options).name).toBe("Literal &#233; &amp;");
  });

  it.each([
    '<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx>&xxe;</gpx>',
    '<!DOCTYPE gpx SYSTEM "https://example.com/a.dtd"><gpx/>',
    '<gpx><trk>&undefined;</trk></gpx>',
    '<gpx><trk>&#0;</trk></gpx>',
    '<gpx><trk>&#xD800;</trk></gpx>',
    '<gpx><trk>&#x110000;</trk></gpx>',
    '<gpx><trk></gpx>',
    '<html><body>Not GPX</body></html>',
    '<gpx><wpt lat="0" lon="0"/><wpt lat="1" lon="1"/></gpx>',
  ])("rejects unsafe XML or a file without route geometry", (xml) => {
    expect(() => importCourseGpx(xml, options)).toThrow();
  });

  it.each([
    '<trkpt lat="91" lon="0"/>', '<trkpt lat="0" lon="181"/>',
    '<trkpt lat="NaN" lon="0"/>', '<trkpt lat="0" lon="Infinity"/>',
    '<trkpt lat="" lon="0"/>', '<trkpt lon="0"/>', '<trkpt lat="0x10" lon="0"/>',
    '<trkpt lat="1" lon="0"><ele>unknown</ele></trkpt>',
    '<trkpt lat="1" lon="0"><time>2026-02-30T12:00:00Z</time></trkpt>',
    '<trkpt lat="1" lon="0"><time>2026-10-21T12:00:00</time></trkpt>',
  ])("rejects invalid point values rather than silently dropping them", (badPoint) => {
    expect(() => importCourseGpx(gpx(`<trkpt lat="0" lon="0"/>${badPoint}`), options)).toThrow();
  });

  it("rejects files over the byte limit, deeply nested XML, and excessive point counts", () => {
    expect(() => importCourseGpx(`<gpx>${" ".repeat(COURSE_MAX_GPX_BYTES)}</gpx>`, options)).toThrow(/5 MB/);
    expect(() => importCourseGpx(`<gpx>${"<a>".repeat(65)}${"</a>".repeat(65)}</gpx>`, options)).toThrow(/deeply/);
    expect(() => importCourseGpx(gpx('<trkpt lat="0" lon="0"/>'.repeat(50_001)), options)).toThrow(/50,000/);
  });

  it("bounds metadata and allows the caller to override an imported name", () => {
    expect(importCourseGpx(gpx(), { ...options, name: "My course" }).name).toBe("My course");
    expect(() => importCourseGpx(gpx(), { ...options, name: "x".repeat(201) })).toThrow(/200/);
  });

  it("uses GPX 1.0 metadata and falls back from an empty optional name", () => {
    const track = '<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg></trk>';
    expect(importCourseGpx(`<gpx version="1.0"><name>Old trail</name><desc>Original notes</desc>${track}</gpx>`, options))
      .toMatchObject({ name: "Old trail", description: "Original notes" });
    expect(importCourseGpx(`<gpx><metadata><name/></metadata>${track}</gpx>`, options).name).toBe("morning");
  });
});

describe("stored course boundary and statistics", () => {
  it("recomputes submitted distances and ascent and strips unrelated fields", () => {
    const imported = importCourseGpx(gpx('<trkpt lat="0" lon="0"><ele>0</ele></trkpt><trkpt lat="0" lon="0.001"><ele>12</ele></trkpt>'), options);
    const course = parseCourse({ ...imported, distanceM: 100_000, ascentM: 900, lifecycle: "completed" });
    expect(course.distanceM).toBeCloseTo(111.1949, 2);
    expect(course.ascentM).toBe(12);
    expect(course).not.toHaveProperty("lifecycle");
  });

  it("validates generated source requests and activity consistency", () => {
    const imported = importCourseGpx(gpx(), options);
    const source = { kind: "generated", provider: "brouter", profile: "trekking", request };
    expect(parseCourse({ ...imported, source }).source).toEqual(source);
    expect(() => parseCourse({ ...imported, source, activity: "Ride" })).toThrow(/activity/i);
    expect(() => parseCourse({ ...imported, id: "../../route" })).toThrow(/ID/);
    expect(() => parseCourse({ ...imported, source: { ...source, provider: "imaginary" } })).toThrow(/source/);
    expect(() => parseCourse({ ...imported, source: { ...source, profile: "../../secret" } })).toThrow(/profile/);
  });

  it("reports unavailable ascent for partial elevation and does not bridge singleton segments", () => {
    const stats = courseStats([
      [{ lat: 0, lng: 0, elevationM: 0 }, { lat: 0, lng: 0.001, elevationM: 10 }],
      [{ lat: 90, lng: 100 }],
    ]);
    expect(stats.distanceM).toBeCloseTo(111.1949, 2);
    expect(stats.ascentM).toBeNull();
    expect(courseStats([])).toEqual({ distanceM: 0, ascentM: null });
  });
});

describe("collection route export", () => {
  const route = {
    name: "Recorded & sampled",
    description: "Bay trail",
    type: "Run",
    lifecycle: "completed",
    route: [
      { lat: 0, lng: 0, elev: 0, d: 0, elapsedS: 5 },
      { lat: 0, lng: 0.001, elev: 10, d: 111, elapsedS: 25 },
      { lat: 0, lng: 10, elev: 100, d: 1_000_000, elapsedS: 925 },
      { lat: 0, lng: 10.001, elev: 101, d: 1_000_111, elapsedS: 945 },
    ],
    provenance: {
      temporal: { status: "recorded", startTimeUtc: "2026-10-20T12:00:00Z", elapsedTimeS: 945 },
      track: { segmentCount: 2 },
      discontinuities: [{ kind: "segment_boundary", source: "recorded_track_segment", startD: 111, endD: 1_000_000 }],
    },
  } as QuestRoute;

  it("exports separate segments and only evidence-backed timestamps", () => {
    const exported = questRouteGpx(route);
    const course = importCourseGpx(exported, options);
    expect(course.name).toBe("Recorded & sampled");
    expect(course.segments.map((segment) => segment.length)).toEqual([2, 2]);
    expect(course.distanceM).toBeCloseTo(222.3898, 2);
    expect(course.segments[0][0].time).toBe("2026-10-20T12:00:05.000Z");
    expect(course.segments[1][1].time).toBe("2026-10-20T12:15:45.000Z");
    expect(exported).not.toContain("<ele>");
    expect(course.description).toContain("Elevation is omitted");
  });

  it("does not create timestamps when temporal provenance is unavailable", () => {
    const exported = questRouteGpx({ ...route, provenance: { ...route.provenance, temporal: { status: "unavailable" } } });
    expect(exported).not.toContain("<time>");
  });

  it("splits sampled edges crossing recorded gaps even when source endpoints were not retained", () => {
    const exported = questRouteGpx({ ...route, provenance: {
      ...route.provenance,
      discontinuities: [{ kind: "recording_gap", source: "recorded_timestamps", startD: 120, endD: 999_999 }],
    } });
    expect(importCourseGpx(exported, options).segments.map((segment) => segment.length)).toEqual([2, 2]);
  });

  it("rejects planned routes without recorded geometry", () => {
    expect(() => questRouteGpx({ ...route, lifecycle: "planned" })).toThrow(/geometry/);
  });
});
