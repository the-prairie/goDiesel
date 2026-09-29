import { APP_PATHS, atlasReturnPath, routeDetailPath, isDesignSeedStoryPath } from "@/app/route-paths";

/**
 * Replay of another recording in the same adventure. The presentation carries
 * over; the way back is rewritten to that recording's own story (or kept when
 * it is the Atlas), so each leg returns to the page that describes it.
 */
export function adventureLegPath(search: string, fromSlug: string, toSlug: string, atM?: number) {
  const params = new URLSearchParams(search);
  const returnPath = params.get("from");
  params.delete("at");
  params.delete("from");
  if (returnPath && atlasReturnPath(new URLSearchParams({ from: returnPath }))) {
    params.set("from", returnPath);
  } else if (returnPath === routeDetailPath(fromSlug)) {
    params.set("from", routeDetailPath(toSlug));
  } else if (returnPath && isDesignSeedStoryPath(returnPath, fromSlug)) {
    const [pathname, query] = returnPath.split("?");
    const story = `${pathname.slice(0, pathname.lastIndexOf("/") + 1)}${encodeURIComponent(toSlug)}`;
    params.set("from", query ? `${story}?${query}` : story);
  }
  if (atM !== undefined && atM > 0) params.set("at", String(Math.round(atM)));
  const query = params.toString();
  return `${APP_PATHS.replay}/${encodeURIComponent(toSlug)}${query ? `?${query}` : ""}`;
}
