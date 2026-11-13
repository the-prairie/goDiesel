export const APP_PATHS = {
  atlas: "/atlas",
  finder: "/finder",
  routes: "/routes",
  replay: "/replay",
  admin: "/admin",
} as const;

export const PLAYABLE_EARTH_LAB_PATH = "/lab/playable-earth";
export const OVERLAND_LAB_PATH = "/lab/overland";

export type OverlandView = "map" | "index";

/** The Overland world map, or its index, optionally at one town. */
export function overlandWorldPath(options: { town?: string; view?: OverlandView } = {}) {
  const query = new URLSearchParams();
  if (options.town) query.set("town", options.town);
  if (options.view === "index") query.set("view", "index");
  const search = query.toString();
  return search ? `${OVERLAND_LAB_PATH}?${search}` : OVERLAND_LAB_PATH;
}

/** One route's entry in the Overland lab. */
export function overlandEntryPath(slug: string) {
  return `${OVERLAND_LAB_PATH}/${encodeURIComponent(slug)}`;
}

/**
 * One route's 3D world, jumped into from its entry. `live` selects the
 * live pixelation, kept for local comparison; the wipe is the default.
 */
export function overlandRealmPath(slug: string, transition: "wipe" | "live" = "wipe") {
  const path = `${overlandEntryPath(slug)}/3d`;
  return transition === "live" ? `${path}?jump=live` : path;
}

/** One of her places as a 3D town, optionally with one signpost chosen. */
export function overlandTownPath(townSlug: string, sign?: string) {
  const path = `${OVERLAND_LAB_PATH}/town/${encodeURIComponent(townSlug)}`;
  return sign ? `${path}?${new URLSearchParams({ sign })}` : path;
}

/** A route's 3D world, jumped into from its signpost in a town. */
export function overlandTownRealmPath(townSlug: string, routeSlug: string) {
  return `${OVERLAND_LAB_PATH}/town/${encodeURIComponent(townSlug)}/${encodeURIComponent(routeSlug)}/3d`;
}

function encodedSlug(slug: string) {
  return encodeURIComponent(slug);
}

export function routeDetailPath(slug: string) {
  return `${APP_PATHS.routes}/${encodedSlug(slug)}`;
}

export function replayPath(slug: string, returnPath?: string) {
  const path = `${APP_PATHS.replay}/${encodedSlug(slug)}`;
  return returnPath ? `${path}?from=${encodeURIComponent(returnPath)}` : path;
}

export function atlasReturnPath(searchParams: URLSearchParams) {
  const path = searchParams.get("from");
  return path === APP_PATHS.atlas || path?.startsWith(`${APP_PATHS.atlas}?`)
    ? path
    : undefined;
}

export function playableEarthLabPath(slug: string, origin?: "replay") {
  const path = `${PLAYABLE_EARTH_LAB_PATH}/${encodedSlug(slug)}`;
  return origin ? `${path}?from=${origin}` : path;
}

export function decodedRouteSlug(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

// Legacy `#quest/<slug>` links. The router matches this path itself, so a link
// opened after the app has started is canonicalized by the same navigation that
// reads it, never by a separate listener racing the catch-all redirect.
export const LEGACY_QUEST_ROUTE_PATH = "quest/:legacySlug";

/** Rewrites a legacy link opened before the router reads its first location. */
export function canonicalizeLegacyQuestHash() {
  const match = window.location.hash.match(/^#quest\/(.+)$/);
  if (!match?.[1]) return false;

  const path = routeDetailPath(decodedRouteSlug(match[1]) ?? match[1]);
  window.location.replace(
    `${window.location.pathname}${window.location.search}#${path}`,
  );
  return true;
}
