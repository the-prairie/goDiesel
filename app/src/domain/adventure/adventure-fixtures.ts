// Synthetic fixtures. No real adventure content belongs in the repository.

import type { QuestRoute, RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";

const METRES_PER_DEGREE_LAT = 111_195;

/** A straight northward recording at lng 0, one point every 100 m. */
export function syntheticTrace(lengthM: number, originLat = 0): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let d = 0; d <= lengthM; d += 100) {
    points.push({ lat: originLat + d / METRES_PER_DEGREE_LAT, lng: 0, elev: d / 10, d });
  }
  return points;
}

export function coordinateAt(d: number, originLat = 0) {
  return { lat: originLat + d / METRES_PER_DEGREE_LAT, lng: 0 };
}

export function syntheticRoute(
  slug: string,
  lengthM: number,
  discontinuities: RouteDiscontinuityEvidence[] = [],
  originLat = 0,
): QuestRoute {
  const route = syntheticTrace(lengthM, originLat);
  return {
    slug,
    route,
    provenance: {
      temporal: { status: "recorded" },
      track: { segmentCount: 1 },
      discontinuities,
    },
  } as unknown as QuestRoute;
}

export function syntheticAdventureJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "ridge-day",
    title: "Ridge day.",
    source: { kind: "prepared-pack", packId: "ridge-day", packSchemaVersion: 1, sha256: "a".repeat(64) },
    legs: [
      { slug: "leg-one", label: "Morning" },
      { slug: "leg-two", label: "Afternoon" },
    ],
    chapters: [
      { id: "top", title: "The top", note: "Wind.", footageId: "clip-a", anchor: { slug: "leg-two", atDistanceM: 3000, source: coordinateAt(3000) } },
      { id: "start", title: "Start", anchor: { slug: "leg-one", atDistanceM: 0, source: coordinateAt(0) } },
      { id: "saddle", title: "The saddle", anchor: { slug: "leg-two", atDistanceM: 1000, source: coordinateAt(1000) } },
    ],
    footage: [
      { id: "clip-a", kind: "video", title: "Clip A", src: "media/clip-a.mp4", poster: "media/clip-a.jpg", sha256: "b".repeat(64) },
      { id: "clip-b", kind: "video", title: "Clip B", src: "media/clip-b.mp4", sha256: "c".repeat(64) },
    ],
    scenes: [
      {
        id: "cirque",
        provider: "sketchfab",
        modelId: "0123456789abcdef0123456789abcdef",
        title: "The cirque",
        posterAlt: "A captured model of the cirque.",
        attribution: { author: "A. Author", url: "https://sketchfab.com/models/0123456789abcdef0123456789abcdef" },
        anchor: { slug: "leg-two", atDistanceM: 2000, source: coordinateAt(2000) },
        tour: { title: "Around the cirque", shots: [
          { atS: 0, title: "Rim.", position: [1, 2, 3], target: [0, 0, 0] },
          { atS: 6, title: "Floor.", position: [3, 2, 1], target: [0, 0, 0] },
        ] },
      },
    ],
    film: {
      title: "Ridge day.",
      cta: "Watch the day",
      beats: [
        { kind: "footage", title: "Up.", footageId: "clip-a", inS: 0, outS: 4 },
        { kind: "route", title: "Along.", durationS: 3 },
        { kind: "scene", title: "Round.", sceneId: "cirque", inS: 0, outS: 5, durationS: 5, fallback: { footageId: "clip-b", inS: 1, outS: 6 } },
      ],
    },
  };
}
