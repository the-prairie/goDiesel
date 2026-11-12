import { isCompletedRoute } from "@/domain/route/lifecycle";
import { recordedClimbM, type RouteSummary } from "@/domain/route";

/**
 * One route as the pixel world shows it. Her title and note are carried
 * exactly as she wrote them; nothing here trims, cases or shortens them.
 */
export interface OverlandEntry {
  /** 1 for her oldest completed route, counting up by date. */
  number: number;
  slug: string;
  title: string;
  note: string | null;
  place: string;
  date: string;
  km: number;
  /** Recorded climb in metres; null when the source recorded no elevation. */
  climbM: number | null;
  kind: "run" | "ride";
}

const activityIdOrder = new Intl.Collator("en", { numeric: true });

function chronological(a: RouteSummary, b: RouteSummary) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return activityIdOrder.compare(a.activityId, b.activityId);
}

export function buildOverlandEntries(routes: readonly RouteSummary[]): OverlandEntry[] {
  return routes
    .filter(isCompletedRoute)
    .sort(chronological)
    .map((route, index) => ({
      number: index + 1,
      slug: route.slug,
      title: route.activityName,
      note: route.description === "" ? null : route.description,
      place: route.region,
      date: route.date,
      km: route.distanceKm,
      climbM: recordedClimbM(route),
      kind: /Ride$/.test(route.type) ? "ride" : "run",
    }));
}
