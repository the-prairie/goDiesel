// A town's input to the generator, from the app's own route data: her
// routes in that place, numbered as the index numbers them, the place's
// biome, and the way each route leaves its start.

import type { RouteSummary } from "@/domain/route";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import type { OverlandTown } from "@/labs/overland/model/overland-towns";
import { placeLook } from "@/labs/overland/model/place-biomes";
import type { TownInput } from "@/labs/overland/model/town-plan";

/** A place's name as a path segment: "Kyoto, Japan" is `kyoto-japan`. */
export function townSlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function townBySlug<T extends Pick<OverlandTown, "name">>(towns: readonly T[], slug: string): T | undefined {
  return towns.find((town) => townSlug(town.name) === slug);
}

/** The compass bearing from the route's start to a point about 150 m on. */
export function startBearing(points: ReadonlyArray<{ lat: number; lng: number }>) {
  if (points.length < 2) return 0;
  const [first] = points;
  const cos = Math.cos((first.lat * Math.PI) / 180);
  const offset = (point: { lat: number; lng: number }) => ({ east: (point.lng - first.lng) * cos * 111_320, north: (point.lat - first.lat) * 110_540 });
  const far = points.find((point) => Math.hypot(offset(point).east, offset(point).north) >= 150) ?? points[points.length - 1];
  const { east, north } = offset(far);
  if (east === 0 && north === 0) return 0;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

export function townInput(town: OverlandTown, summaries: readonly RouteSummary[], entries: readonly OverlandEntry[]): TownInput {
  const look = placeLook(town.name, town.lat);
  const routes = entries
    .filter((entry) => entry.place === town.name)
    .map((entry) => {
      const summary = summaries.find((candidate) => candidate.slug === entry.slug);
      return {
        slug: entry.slug,
        number: entry.number,
        title: entry.title,
        km: entry.km,
        date: entry.date,
        kind: entry.kind,
        startBearingDeg: summary ? startBearing(summary.trace) : 0,
      };
    });
  return { place: town.name, lat: town.lat, lng: town.lng, biome: look.biome, coastal: look.coastal, routes, residents: [] };
}
