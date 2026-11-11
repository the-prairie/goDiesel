import type { ExternalRoute } from "./external";
export interface RouteQuality {
  shape: "loop" | "open" | "branched" | "disconnected";
  components: number;
  mappedKm: number;
  distanceMismatch: boolean;
}
export function pathDistance(a: number[], b: number[]) {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
/** Topology of the mapped paths, not a guarantee of access or a navigation itinerary.
 * Only identical coordinates connect. Never snap or invent a connecting segment. */
export function assessRoute(
  route: Pick<ExternalRoute, "lines" | "distanceKm" | "distanceKind">,
): RouteQuality {
  const adjacent = new Map<string, Set<string>>();
  let mappedKm = 0;
  const key = (p: number[]) => `${p[0]},${p[1]}`;
  const edges = new Set<string>();
  for (const line of route.lines)
    for (let i = 1; i < line.length; i++) {
      const a = key(line[i - 1]),
        b = key(line[i]);
      if (a === b) continue;
      const edge = [a, b].sort().join("|");
      if (edges.has(edge)) continue;
      edges.add(edge);
      mappedKm += pathDistance(line[i - 1], line[i]);
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      if (!adjacent.has(b)) adjacent.set(b, new Set());
      adjacent.get(a)!.add(b);
      adjacent.get(b)!.add(a);
    }
  const visited = new Set<string>();
  let components = 0;
  for (const start of adjacent.keys()) {
    if (visited.has(start)) continue;
    components++;
    const stack = [start];
    visited.add(start);
    while (stack.length)
      for (const next of adjacent.get(stack.pop()!)!) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
  }
  const degrees = [...adjacent.values()].map((s) => s.size);
  const shape =
    components !== 1
      ? "disconnected"
      : degrees.every((d) => d === 2)
        ? "loop"
        : degrees.some((d) => d > 2)
          ? "branched"
          : "open";
  return {
    shape,
    components,
    mappedKm,
    distanceMismatch:
      route.distanceKind === "source" &&
      Math.abs(route.distanceKm - mappedKm) >
        Math.max(0.5, route.distanceKm * 0.25),
  };
}
export const shapeLabels = {
  loop: "Mapped loop",
  open: "Open path",
  branched: "Branching paths",
  disconnected: "Disconnected sections",
};
export const shapeGuidance = {
  loop: "The mapped paths connect into a loop.",
  open: "The mapped path has two ends. Plan your return; an out-and-back distance may be longer.",
  branched:
    "The map includes branches. Choose your path before heading out; the total includes all mapped branches.",
  disconnected:
    "The mapped sections do not all connect. Review the gaps before planning an outing.",
};
