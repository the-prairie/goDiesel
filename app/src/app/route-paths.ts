export const APP_PATHS = {
  atlas: "/atlas",
  finder: "/finder",
  routes: "/routes",
  replay: "/replay",
  admin: "/admin",
} as const;

export const PLAYABLE_EARTH_LAB_PATH = "/lab/playable-earth";

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

export function canonicalizeLegacyQuestHash() {
  const match = window.location.hash.match(/^#quest\/(.+)$/);
  if (!match?.[1]) return false;

  const path = routeDetailPath(decodedRouteSlug(match[1]) ?? match[1]);
  window.location.replace(
    `${window.location.pathname}${window.location.search}#${path}`,
  );
  return true;
}
