/**
 * The day page of another recording in the same adventure, held at a chapter.
 *
 * The thread distance this page holds (`at`) belongs to this page only; the
 * link carries the target chapter's own distance instead, including 0 for a
 * chapter at the start. Everything else, the parent return in `from` among
 * it, is kept as it is.
 */
export function adventureStoryPath(pathname: string, search: string, toSlug: string, atM: number) {
  const params = new URLSearchParams(search);
  params.set("at", String(Math.max(0, Math.round(atM))));
  return `${pathname.replace(/[^/]+$/, encodeURIComponent(toSlug))}?${params.toString()}`;
}
