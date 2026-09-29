import { replayPath, routeDetailPath } from "@/app/route-paths";

/**
 * Replay of a chapter's own recording at the chapter's distance, returning to
 * that recording's story. A chapter on the adventure's other recording opens
 * that recording, never this one at a borrowed distance.
 */
export function chapterReplayHref(slug: string, atDistanceM: number) {
  const href = replayPath(slug, routeDetailPath(slug));
  const at = Math.round(atDistanceM);
  return at > 0 ? `${href}&at=${at}` : href;
}
