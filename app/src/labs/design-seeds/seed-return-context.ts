import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Scoped return context for the journal.
 *
 * The visible "<- Crete" link is a real URL, not a history gesture, so the
 * region, the selected day and the presentation already survive the round trip
 * in the address. What an address cannot carry is where you were in the list.
 *
 * The application's own convention (`useNavigationScrollRegion`) restores a
 * scrolled region only for POP navigations - browser Back - because a forward
 * link normally means "somewhere new, start at the top". That is the right
 * default for ordinary links and the wrong one for this link, whose entire
 * purpose is to put you back where you were reading. So the journal keeps its
 * own store and does not register a `data-navigation-scroll` region; using both
 * would leave two mechanisms writing the same scrollTop in an order that
 * depends on effect timing.
 *
 * The store is keyed by the journey, not by a history entry, so:
 *  - the visible link, browser Back and browser Forward all restore alike;
 *  - opening a different region, or the same region in a different
 *    presentation, finds no entry and starts at the top;
 *  - one journey cannot overwrite another's position.
 */

export interface JournalReturnKeyInput {
  concept: string;
  region: string;
  /** Presentation is part of the identity: a different cast reflows the list. */
  theme?: string | null;
  typeface?: string | null;
}

/**
 * A stable identity for "the journal you were reading".
 *
 * Deliberately excludes the selected route. Choosing another day inside the
 * same region is the same journey and rewrites the URL in place, so keying on
 * the selection would drop the position on every selection.
 */
export function journalReturnKey({
  concept,
  region,
  theme,
  typeface,
}: JournalReturnKeyInput): string {
  return [concept, region, theme ?? "default", typeface ?? "default"]
    .map((part) => encodeURIComponent(part))
    .join("|");
}

/** Small enough that a long session cannot grow it without bound. */
const LIMIT = 12;
const positions = new Map<string, number>();

export function writeJournalPosition(key: string, top: number) {
  if (!key) return;
  // Re-insert so the most recently used key is last, and evict the oldest.
  positions.delete(key);
  positions.set(key, Math.max(0, Math.round(top)));
  if (positions.size > LIMIT) {
    const oldest = positions.keys().next();
    if (!oldest.done) positions.delete(oldest.value);
  }
}

export function readJournalPosition(key: string): number | undefined {
  return positions.get(key);
}

/** Test seam. Not used by the surfaces. */
export function clearJournalPositions() {
  positions.clear();
}

/**
 * Restore before paint, then keep the stored offset current.
 *
 * The journal's rows come from generated data that is already in the bundle, so
 * the list is laid out on the first render and a layout effect is genuinely
 * "after the content is ready". Assigning `scrollTop` here happens before the
 * browser paints, which is why the return does not show the top of the list and
 * then correct itself.
 *
 * @returns whether a stored position was applied, so the caller can leave the
 * selected row where the reader left it instead of scrolling it into view.
 */
export function useJournalPosition(
  key: string,
  /**
   * Whichever element the composition scrolls.
   *
   * On desktop that is the journal leaf; on a phone it is the whole page below
   * the header, so the selected-day preview scrolls away and the days get the
   * screen. The store holds an offset for a journey and does not care which
   * element produced it - the composition chooses the scroller and the store
   * follows, never the other way round.
   */
  regionRef: RefObject<HTMLElement | null>,
) {
  const restored = useRef(false);
  /*
   * The last offset the reader actually scrolled to.
   *
   * Cleanup must not read `node.scrollTop`. Moving between regions inside the
   * mounted Atlas changes the rows before effects run, and a shorter list makes
   * the browser clamp the offset - so cleanup for the region being left saw 0
   * and stored 0, losing the position for a journey the reader had not
   * finished. Measured: leaving Crete at 248 for a four-row region stored
   * Crete = 0. This ref is only ever written from a scroll event, so it still
   * holds 248 at that moment.
   */
  const lastTop = useRef(0);

  useLayoutEffect(() => {
    const node = regionRef.current;
    if (!node) return;

    /*
     * Always assign, never merely skip.
     *
     * Leaving the offset alone when there is nothing stored looked harmless and
     * was not: switching presentation inside the mounted Atlas kept the
     * previous view's 114px, which is exactly "restoring an unrelated
     * position". An unknown journey starts at the top, and the selected row is
     * then scrolled into view by the caller.
     */
    const saved = readJournalPosition(key);
    node.scrollTop = saved ?? 0;
    lastTop.current = node.scrollTop;
    restored.current = saved !== undefined;

    /*
     * Re-assert the offset while the content is still too short to hold it.
     *
     * A layout effect runs after the rows are in the DOM but the scroller can
     * still be shorter than it will be a frame later - the editorial webfonts
     * arrive asynchronously and every row grows when they do. Assigning 248 to
     * a scroller whose range is momentarily 0 silently clamps to 0, and the
     * reader lands at the top of the list having asked to come back to the
     * middle of it. This made the return-path check flake rather than fail:
     * warm font cache passed, cold clamped.
     *
     * So: only while the range genuinely cannot honour the target, and only for
     * a handful of frames, put it back. It stops the moment the offset sticks
     * or the reader scrolls somewhere else themselves.
     */
    let settle = 0;
    const reassert = () => {
      if (saved === undefined) return;
      const range = node.scrollHeight - node.clientHeight;
      if (node.scrollTop === saved || settle > 10) return;
      if (range >= saved) node.scrollTop = saved;
      // Anything other than the clamp means the reader has taken over.
      if (node.scrollTop !== saved && node.scrollTop !== range) return;
      lastTop.current = node.scrollTop;
      settle += 1;
      settleFrame = window.requestAnimationFrame(reassert);
    };
    let settleFrame = window.requestAnimationFrame(reassert);

    let frame = 0;
    const record = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const range = node.scrollHeight - node.clientHeight;
        const top = node.scrollTop;
        /*
         * A scroll event is not proof that the reader scrolled.
         *
         * When a composition tears down its content collapses, and the browser
         * pulls `scrollTop` down to the new, smaller maximum - firing a scroll
         * event like any other. Recording that stored the collapse and restored
         * it next time.
         *
         * A clamp has a signature the reader cannot fake: the offset moved
         * DOWN, it landed exactly on the maximum, and the position being held
         * is now past that maximum. Scrolling to the bottom also lands on the
         * maximum but moves up, not down, so the two are distinguishable.
         *
         * An earlier attempt compared the range against its previous value and
         * was wrong: the list shrinks 274 -> 248 when the editorial webfont
         * lands, so a genuine scroll to the bottom looked like a clamp and
         * nothing was recorded at all.
         */
        const clamped = top < lastTop.current && top >= range - 1 && range < lastTop.current;
        if (clamped) return;
        lastTop.current = top;
        writeJournalPosition(key, top);
      });
    };
    node.addEventListener("scroll", record, { passive: true });

    return () => {
      node.removeEventListener("scroll", record);
      if (frame) window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      // The last chance to record, and the one that matters: leaving for a day
      // happens without a further scroll event.
      writeJournalPosition(key, lastTop.current);
    };
  }, [key, regionRef]);

  return restored;
}
