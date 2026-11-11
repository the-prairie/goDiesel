export interface DiscoveryPlace {
  name: string;
  lat: number;
  lng: number;
}
export interface ExternalRoute {
  id: string;
  name: string;
  sourceUrl: string;
  activity: "Run" | "Ride";
  lines: [number, number][][];
  distanceKm: number;
  distanceKind: "source" | "mapped";
  ascentM?: number;
  surface?: string;
  surfaceEvidence?: "relation" | "all-ways";
  surfaces?: string[];
  surfaceCoverage?: number;
  description?: string;
}
interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: {
    type: string;
    ref: number;
    role?: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}
const validPoint = (p: { lat: number; lon: number }) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180;
export function parseExternalRoutes(data: {
  elements?: OsmElement[];
}): ExternalRoute[] {
  const wayTags = new Map(
    (data.elements ?? [])
      .filter((e) => e.type === "way")
      .map((e) => [e.id, e.tags ?? {}]),
  );
  return (data.elements ?? [])
    .filter((e) => e.type === "relation")
    .slice(0, 80)
    .flatMap((r) => {
      if (
        r.type !== "relation" ||
        !Number.isSafeInteger(r.id) ||
        r.id <= 0 ||
        !r.tags?.name ||
        !r.members?.length
      )
        return [];
      const type = r.tags.route;
      if (!["hiking", "foot", "running", "bicycle", "mtb"].includes(type))
        return [];
      const ways = r.members.filter((m) => m.type === "way");
      // Reject incomplete relations. Keep each real member separate, never join gaps.
      if (
        r.members.some((m) => m.type === "relation") ||
        !ways.length ||
        ways.some(
          (m) =>
            !m.geometry ||
            m.geometry.length < 2 ||
            m.geometry.some((p) => !validPoint(p)),
        )
      )
        return [];
      const unique = [...new Map(ways.map((w) => [w.ref, w])).values()];
      const lines = unique.map((m) =>
        m.geometry!.map((p) => [p.lon, p.lat] as [number, number]),
      );
      if (lines.reduce((n, l) => n + l.length, 0) > 25000) return [];
      const mapped = lines.reduce(
        (n, l) => n + l.slice(1).reduce((d, p, i) => d + haversine(l[i], p), 0),
        0,
      );
      const surfaces = [
        ...new Set(
          unique
            .map((w) => wayTags.get(w.ref)?.surface)
            .filter((v): v is string => !!v),
        ),
      ];
      const taggedLength = unique.reduce(
        (n, w) =>
          n +
          (wayTags.get(w.ref)?.surface
            ? w
                .geometry!.slice(1)
                .reduce(
                  (d, p, i) =>
                    d +
                    haversine(
                      [w.geometry![i].lon, w.geometry![i].lat],
                      [p.lon, p.lat],
                    ),
                  0,
                )
            : 0),
        0,
      );
      const allTagged = unique.every((w) => !!wayTags.get(w.ref)?.surface);
      const distance = r.tags.distance?.match(
        /^(\d+(?:\.\d+)?)\s*(km|mi|m)?$/i,
      );
      const supplied = distance
        ? Number(distance[1]) *
          (distance[2]?.toLowerCase() === "mi"
            ? 1.609344
            : distance[2]?.toLowerCase() === "m"
              ? 0.001
              : 1)
        : 0;
      const ascent = r.tags.ascent?.match(/^(\d+(?:\.\d+)?)\s*m?$/);
      if (mapped <= 0 || mapped > 1000) return [];
      return [
        {
          id: `osm-${r.id}`,
          name: r.tags.name.slice(0, 200),
          sourceUrl: `https://www.openstreetmap.org/relation/${r.id}`,
          activity:
            type === "bicycle" || type === "mtb"
              ? ("Ride" as const)
              : ("Run" as const),
          lines,
          distanceKm: supplied > 0 ? supplied : mapped,
          distanceKind:
            supplied > 0 ? ("source" as const) : ("mapped" as const),
          ascentM: ascent ? Number(ascent[1]) : undefined,
          surface:
            r.tags.surface ||
            (allTagged && surfaces.length === 1 ? surfaces[0] : undefined),
          surfaceEvidence: r.tags.surface
            ? "relation"
            : allTagged && surfaces.length === 1
              ? "all-ways"
              : undefined,
          surfaces: r.tags.surface ? [r.tags.surface] : surfaces,
          surfaceCoverage: r.tags.surface
            ? 1
            : mapped
              ? taggedLength / mapped
              : 0,
          description: r.tags.description?.slice(0, 400),
        },
      ];
    });
}
function haversine(a: number[], b: number[]) {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
