import { activityNoun, isOnFoot } from "@/domain/route/activity";
import type { QuestRoute, RouteSummary } from "@/domain/route";

/**
 * Copy and formatting shared by all three design seeds.
 *
 * Rules applied here (invariants, not aesthetics):
 * - Lauren's original title is preserved verbatim, including emoji-only titles.
 *   Production falls back to the region name when a title has no alphanumerics
 *   (route-story.ts routeStoryTitle); that erases the most personal titles in
 *   the set, so the seeds keep them and let type carry them.
 * - A completed route is a memory. A discovered route is imported geometry and
 *   is never described as something Lauren did.
 * - Evidence is demoted to a footnote, never deleted and never contradicted.
 */

/** Lauren's words, unedited. Never substitutes the region. */
export function personalTitle(route: RouteSummary | QuestRoute): string {
  return route.activityName.trim() || route.subtitle.trim() || route.name;
}

/** True when the title carries no letters or digits - it needs display treatment, not rejection. */
export function isExpressiveTitle(route: RouteSummary | QuestRoute): boolean {
  return !/[a-z0-9]/i.test(personalTitle(route));
}

export function isMemory(route: RouteSummary | QuestRoute): boolean {
  return route.lifecycle === "completed";
}

/** Human date. "17 December 2024", not an ISO string. */
export function readableDate(iso: string): string {
  if (!iso) return "Date not recorded";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return iso;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function shortDate(iso: string): string {
  if (!iso) return "--";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return iso;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function yearOf(iso: string): string {
  return iso ? iso.slice(0, 4) : "";
}

/**
 * What the route asked of you, in one line, from recorded numbers only.
 * Replaces "Complete a 21.8 km run in Tokyo with about 286 m of climbing."
 */
export function effortLine(route: RouteSummary | QuestRoute): string {
  const climb = route.elevationGainM;
  const perKm = climb && route.distanceKm ? climb / route.distanceKm : 0;
  if (perKm >= 40) return "Relentlessly steep";
  if (perKm >= 25) return "Serious climbing";
  if (perKm >= 12) return "Rolling";
  if (perKm > 0) return "Mostly flat";
  return "Climb not recorded";
}

/**
 * The evidence footnote. Quiet, accurate, and only says something when there is
 * something worth saying. Returns null when the route is an ordinary recording.
 */
export function evidenceFootnote(route: QuestRoute): string | null {
  const notes: string[] = [];
  if (route.lifecycle === "discovered") {
    notes.push("Imported route - not one of your recordings");
  }
  if (route.elevationStatus && route.elevationStatus !== "recorded") {
    notes.push("Elevation estimated from the track");
  }
  const gaps = route.provenance?.discontinuities?.length ?? 0;
  if (gaps > 0) {
    notes.push(gaps === 1 ? "One gap in the recording" : `${gaps} gaps in the recording`);
  }
  if (route.provenance?.temporal?.status && route.provenance.temporal.status !== "recorded") {
    notes.push("Timing estimated");
  }
  return notes.length ? notes.join(" · ") : null;
}

/**
 * Where a curated note came from, when one exists. Absent otherwise - never invented.
 *
 * A discovered route is imported geometry, not something Lauren ran, so its note
 * must never be labelled as hers. Calling it "Your note" on an imported route
 * would present a description as a memory.
 */
export function guideAttribution(route: QuestRoute): string {
  /*
   * A curated vibe is never her writing, whatever the lifecycle.
   *
   * This used to return "Your note" for a completed route, which put her name
   * to guide copy: the curation record alongside it carries reviewStatus,
   * ideal_use and an editorial_note reading "Selected as the first guide
   * because...". It is a description OF the route, so that is what it is
   * called - on Kyoto, which she did run, exactly as on Rome, which she did
   * not. Only `description` on one of her own recordings is her voice.
   */
  const reviewed =
    route.curation?.reviewStatus === "reviewed" || route.curation?.reviewStatus === "published";
  return reviewed ? "About this route" : "About this route · draft";
}

/**
 * The note that belongs on the page, and whose voice it is.
 *
 * Her own words lead when they exist. `description` is hers only on a route she
 * recorded; on an imported route it arrived with the file, so it is a
 * description of the route rather than a memory of running it. A curated `vibe`
 * is never her writing whatever the lifecycle.
 */
export function routeNote(route: QuestRoute): { body: string; own: boolean } {
  const curated = route.curation?.vibe?.trim() ?? "";
  const written = route.description.trim();
  const own = isMemory(route) ? written : "";
  return { body: own || curated || written, own: Boolean(own) };
}

/**
 * The Replay call to action. "again" is only true for a route she has actually
 * run; an imported route has never been flown by her.
 */
export function replayActionLabel(route: QuestRoute): string {
  return isMemory(route) ? "Fly this route again" : "Fly this route";
}

export function distanceLabel(km: number): string {
  return `${km.toFixed(1)} km`;
}

export function climbLabel(m: number | null): string {
  return m === null ? "not recorded" : `${m.toLocaleString("en-GB")} m`;
}

/** Elapsed time from recorded provenance, when recorded. */
export function movingTime(route: QuestRoute): string | null {
  const seconds = route.provenance?.temporal?.elapsedTimeS;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

/**
 * How the region was covered, from the recorded activity types only.
 *
 * An earlier draft hardcoded "on foot" in the region aggregate. That is true for
 * Crete (all 8 routes are runs) but false for Banff/Kananaskis and Victoria BC,
 * which both mix runs and rides. The claim now follows the data.
 */
export function coverageLine(routes: RouteSummary[]): string {
  const onFoot = routes.some((route) => isOnFoot(route.type));
  const byBike = routes.some((route) => !isOnFoot(route.type));
  if (onFoot && !byBike) return "on foot";
  if (byBike && !onFoot) return "by bike";
  return "on foot and by bike";
}

/** One place that decides distance formatting, so surfaces cannot disagree. */
export function totalDistanceLabel(routes: RouteSummary[]): string {
  const km = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  return `${km.toFixed(1)} km`;
}

/** Run, Ride or Hike, as a word. Activity type is never carried by colour alone. */
export function activityLabel(route: RouteSummary | QuestRoute): string {
  const noun = activityNoun(route.type);
  return noun[0].toUpperCase() + noun.slice(1);
}
