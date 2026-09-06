import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";

import { useJournalPosition } from "@/labs/design-seeds/seed-return-context";
import { SeedTerrain } from "@/labs/design-seeds/seed-terrain";
import { SeedElevation } from "@/labs/design-seeds/seed-elevation";
import { SeedTraceMark } from "@/labs/design-seeds/seed-profile";
import { useWideLayout } from "@/labs/design-seeds/seed-media";
import {
  JOURNAL, JOURNAL_SURFACES, PLATE_PADDING, type SeedTheme, type SeedTypeface,
} from "@/labs/design-seeds/concept-b-tokens";
import {
  activityLabel, climbLabel, coverageLine, distanceLabel, effortLine,
  isExpressiveTitle, personalTitle, readableDate, totalDistanceLabel,
} from "@/labs/design-seeds/seed-content";
import type { RouteSummary } from "@/domain/route";

/* =============================================================================
   B - EXPEDITION JOURNAL
   The memory is the page; the map is a plate bound into it.
   ========================================================================== */

const {
  IVORY, PLATE_FIELD, INK, INK_2, INK_3, RULE, FOREST, COBALT, CORAL, CORAL_TEXT,
} = JOURNAL;

/** Beyond this a title stops being a headline and becomes a passage to read. */
const LONG_TITLE = 96;

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

/* --------------------------------- Shell ---------------------------------- */

function JournalHeader({ active = "Atlas", compact = false }: { active?: string; compact?: boolean }) {
  return (
    <header
      className={`shrink-0 flex items-center justify-between ${compact ? "px-5" : "px-10"}`}
      style={{ height: 56, borderBottom: `1px solid ${RULE}`, background: IVORY }}
    >
      <span style={{ fontFamily: "var(--font-editorial)", fontSize: 17, fontWeight: 600, letterSpacing: "0.02em" }}>
        goDiesel
      </span>
      <nav aria-label="Sections" className="flex items-center gap-6">
        {["Atlas", "Routes", "Plan", "Replay"].map((item) => (
          <a
            key={item}
            href="#"
            onClick={(event) => event.preventDefault()}
            aria-current={item === active ? "page" : undefined}
            className="seed-control seed-focus inline-flex items-center justify-center"
            style={{
              fontSize: 13,
              color: item === active ? INK : INK_2,
              borderBottom: item === active ? `2px solid ${FOREST}` : "2px solid transparent",
            }}
          >
            {item}
          </a>
        ))}
      </nav>
    </header>
  );
}

/* ---------------------------- Journal entry row --------------------------- */

function JournalRow({
  route, active, onSelect, onPreview, href,
}: {
  route: RouteSummary;
  active: boolean;
  onSelect: () => void;
  onPreview: () => void;
  /**
   * When present the row opens the day instead of selecting it.
   *
   * Two panes can afford select-then-read: choosing a row repaints the plate
   * beside it. Stacked on a phone the plate sits above the fold you are
   * browsing in, so selecting a row asked the reader to scroll back up to an
   * action they could no longer see - and tapping it up there pulled the
   * preview back into view, which is also how the stored reading position
   * ended up wrong. On a phone a list of days is a list of links.
   */
  href?: string;
}) {
  const title = personalTitle(route);
  const expressive = isExpressiveTitle(route);
  const long = title.length > LONG_TITLE;
  const month = new Date(`${route.date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

  const content = (
    <>
      <span className="self-start" style={{ paddingTop: 2 }}>
        <span
          className="block"
          style={{ ...NUM, fontSize: 20, lineHeight: 1, color: active ? CORAL_TEXT : INK }}
        >
          {route.date.slice(8, 10)}
        </span>
        <span
          className="block"
          style={{
            fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            color: active ? CORAL_TEXT : INK_3, marginTop: 4,
          }}
        >
          {month} {route.date.slice(2, 4)}
        </span>
      </span>

      <span className="min-w-0 self-start">
        <span
          className="block"
          /* Her wording, so a check can assert it is still on the row. */
          data-journal-title=""
          style={{
            fontFamily: expressive ? "var(--font-interface)" : "var(--font-editorial)",
            fontSize: expressive ? 24 : long ? 18 : 21,
            lineHeight: long ? 1.32 : 1.24,
            color: INK,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </span>
        <span
          className="mt-2 block"
          style={{ ...NUM, fontSize: 11.5, color: INK_2, letterSpacing: "0.01em" }}
        >
          {activityLabel(route)} · {distanceLabel(route.distanceKm)} ·{" "}
          {climbLabel(route.elevationGainM)} · {effortLine(route)}
        </span>
      </span>

      <SeedTraceMark
        points={route.trace}
        stroke={active ? CORAL : JOURNAL_SURFACES.MINIATURE}
        strokeWidth={active ? 1.9 : 1.15}
        className="seed-miniature size-12 self-start"
        style={{ opacity: active ? 1 : 0.72 }}
        label={title}
      />
    </>
  );

  const shape = {
    // One rhythm for every row, whatever the title length. The list is for
    // recognition; the plate caption is where a title is read.
    gridTemplateColumns: "52px minmax(0,1fr) 48px",
    columnGap: 18,
    minHeight: 80,
    paddingBlock: 14,
    paddingInline: "14px 0",
  } as const;

  return (
    <li style={{ borderTop: `1px solid ${RULE}` }}>
      {href ? (
        <Link
          to={href}
          aria-current={active ? "true" : undefined}
          className="seed-row seed-focus relative grid w-full items-baseline text-left"
          style={{ ...shape, color: INK, textDecoration: "none" }}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onMouseEnter={onPreview}
          onFocus={onPreview}
          aria-current={active ? "true" : undefined}
          className="seed-row seed-focus relative grid w-full items-baseline text-left"
          style={shape}
        >
          {content}
        </button>
      )}
    </li>
  );
}

/* ---------------------------------- Atlas --------------------------------- */

export function ConceptBAtlas({
  region, routes, selected, onSelect, storyHrefFor, theme, typeface, returnKey,
}: {
  region: string;
  routes: RouteSummary[];
  selected: RouteSummary;
  onSelect: (slug: string) => void;
  /** A day's own address, for any day in the region. */
  storyHrefFor: (slug: string) => string;
  /** Identity of this journey, so the reading position returns to it alone. */
  returnKey: string;
  /** Colour only. Layout, type, content and framing do not vary by theme. */
  theme: SeedTheme;
  /** Editorial family only. Sizes, weights and labels do not vary by face. */
  typeface: SeedTypeface;
}) {
  const wide = useWideLayout(1024);
  const [framing, setFraming] = useState<"route" | "region">("route");
  const [inspect, setInspect] = useState<number>();
  /*
   * Whichever element scrolls in this composition: the journal leaf on desktop,
   * the whole page below the header on a phone. One ref, so the reading-position
   * store and the lower-edge fade both follow the composition.
   */
  const scrollRef = useRef<HTMLElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  // Where you were reading, restored before paint for the visible return link
  // as well as for Back and Forward. See seed-return-context.
  const positionRestored = useJournalPosition(returnKey, scrollRef);

  // A journal runs forwards.
  const ordered = useMemo(
    () => [...routes].sort((a, b) => a.date.localeCompare(b.date)),
    [routes],
  );
  const first = ordered[0]?.date ?? "";
  const last = ordered[ordered.length - 1]?.date ?? "";

  const title = personalTitle(selected);
  const longTitle = title.length > LONG_TITLE;

  // Reset the disclosure and the inspected position when the day changes, so
  // selection feedback is never stale.
  useEffect(() => {
    setInspect(undefined);
  }, [selected.slug]);

  const trackEdge = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setAtEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
  }, []);

  useEffect(() => {
    trackEdge();
  }, [trackEdge, ordered.length]);

  /**
   * Keep the selected day visible. On load it can sit below the fold - the
   * fixture route is the 7th of 8 - which made the selection invisible until
   * the reader scrolled. `nearest` avoids yanking the list when the row is
   * already on screen.
   */
  /*
   * Set when the reader picked a row themselves.
   *
   * A selection that arrives from the URL must be made visible - it can name a
   * day well below the fold. A selection the reader just clicked is already in
   * front of them, so scrolling the list under them is at best pointless and at
   * worst fights the position they are holding. Distinguishing the two by where
   * the change came from is the only reliable way; this used to scroll on every
   * selection change.
   */
  const chosenByReader = useRef(false);
  useEffect(() => {
    if (chosenByReader.current) {
      chosenByReader.current = false;
      return;
    }
    if (positionRestored.current) {
      positionRestored.current = false;
      return;
    }
    const node = scrollRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [positionRestored, selected.slug]);

  /* ----------------------------- The pieces ------------------------------ */
  /*
   * One set of parts, assembled two ways.
   *
   * The Atlas had only the two-leaf desktop arrangement, and at 390px the grid
   * simply squeezed: the left leaf became 102px wide, which dropped every
   * personal title out of the rows and broke "24.1 km" onto four lines, and the
   * plate became a sliver. This is the same fix the day page already uses -
   * `useWideLayout` picks a composition, and only one of them mounts, so there
   * is never a second MapLibre instance.
   */

  const regionHeader = (pad: string, size: number) => (
    <div className={pad} style={{ paddingTop: wide ? 30 : 16, paddingBottom: wide ? 20 : 12 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: INK_3 }}>
        {region}
      </div>
      <h1
        style={{
          fontFamily: "var(--font-editorial)", fontWeight: 600, fontSize: size,
          lineHeight: 1.02, marginTop: wide ? 10 : 6, letterSpacing: "0.005em",
        }}
      >
        {region.split(",")[0]}
      </h1>
      <p style={{ ...NUM, marginTop: wide ? 10 : 8, fontSize: 12.5, color: INK_2, lineHeight: 1.5 }}>
        {routes.length} recorded routes · {readableDate(first)} – {readableDate(last)}
        <br />
        {totalDistanceLabel(routes)} {coverageLine(routes)}
      </p>
    </div>
  );

  /* Sticky column heading, so an intermediate scroll position still tells you
     what you are looking at and how it is ordered. */
  const daysHeading = (pad: string) => (
    <div
      className={`sticky z-10 flex items-baseline justify-between ${pad}`}
      style={{
        top: 0,
        height: 34, background: IVORY, borderBottom: `1px solid ${RULE}`,
        fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3,
      }}
    >
      <span>The days</span>
      <span style={{ letterSpacing: "0.08em" }}>oldest first</span>
    </div>
  );

  /*
   * The days.
   *
   * On desktop the left leaf is a bounded scroller with a fade at its lower
   * edge. On a phone the list is simply in flow and the page scrolls: an inner
   * scroller there left about 153px for browsing - under two rows - and fought
   * the preview scrolling away. The reading position follows the scroller the
   * composition chose, not the other way round.
   */
  const days = (pad: string) => (
    <ol
      ref={wide ? (scrollRef as RefObject<HTMLOListElement>) : undefined}
      onScroll={wide ? trackEdge : undefined}
      data-at-end={wide ? (atEnd ? "true" : "false") : undefined}
      /* Names the element the reading position is stored against, so the
         verification scripts assert against the real scroller rather than
         guessing which one the composition chose. */
      data-journal-scroller={wide ? "true" : undefined}
      className={wide ? `seed-scroll min-h-0 flex-1 overflow-y-auto ${pad}` : pad}
      style={{ paddingBottom: wide ? 28 : 24 }}
    >
      {ordered.map((route) => (
        <JournalRow
          key={route.slug}
          route={route}
          active={route.slug === selected.slug}
          onSelect={() => {
            chosenByReader.current = true;
            onSelect(route.slug);
          }}
          onPreview={() => undefined}
          href={wide ? undefined : storyHrefFor(route.slug)}
        />
      ))}
    </ol>
  );

  const plate = (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ border: `1px solid ${INK_3}`, boxShadow: `0 1px 0 ${JOURNAL_SURFACES.PLATE_HIGHLIGHT}` }}
    >
      <SeedTerrain
        routes={routes}
        selectedSlug={selected.slug}
        tone="journal"
        cartography={theme.cartography}
        focusSelected={framing === "route"}
        onSelect={onSelect}
        padding={
          framing === "route"
            ? (wide ? PLATE_PADDING : { top: 34, right: 26, bottom: 40, left: 26 })
            : (wide ? { top: 44, right: 44, bottom: 56, left: 44 } : { top: 26, right: 20, bottom: 34, left: 20 })
        }
        contextZoomOut={framing === "route" ? 0.35 : 0}
        markerProgress={inspect}
        attributionPosition="bottom-left"
      />

      {/* Framing lives ON the map, as a map control - it no longer shares a
          line with the selected title. */}
      <div
        role="group"
        aria-label="Plate framing"
        className="absolute flex overflow-hidden"
        style={{
          top: 12, right: 12,
          background: JOURNAL_SURFACES.PAPER_VEIL,
          border: `1px solid ${INK_3}`,
          backdropFilter: "blur(6px)",
        }}
      >
        {([["route", "This route"], ["region", "Whole region"]] as const).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFraming(value)}
            aria-pressed={framing === value}
            className="seed-control seed-focus-plate"
            style={{
              paddingInline: 14, fontSize: 12,
              letterSpacing: "0.02em",
              background: framing === value ? FOREST : "transparent",
              color: framing === value ? IVORY : INK_2,
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  /*
    Caption: this is where a title is READ, and it is never truncated. The list
    row clamps for recognition; repeating the same elided title here would be
    the same awkward truncation twice. A long title instead steps down to set
    text - which is honest to what it is - and the zone keeps a stable minimum
    so plate height barely moves between a three-word title and a
    233-character one.
  */
  const caption = (
    <figcaption style={{ paddingTop: wide ? 16 : 10 }}>
      <div style={{ minHeight: wide ? 58 : 32 }}>
        <div
          style={{
            fontFamily: isExpressiveTitle(selected) ? "var(--font-interface)" : "var(--font-editorial)",
            fontSize: longTitle ? 15 : wide ? 24 : 21,
            lineHeight: longTitle ? 1.42 : 1.22,
            letterSpacing: longTitle ? "0.01em" : "0",
            color: INK,
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ ...NUM, fontSize: 11.5, color: INK_2, marginTop: wide ? 8 : 6 }}>
        {activityLabel(selected)} · recorded {readableDate(selected.date)}
      </div>
    </figcaption>
  );

  const climbAndAction = (
    <>
      <SeedElevation
        points={selected.trace}
        totalAscentM={selected.elevationGainM}
        height={wide ? 104 : 62}
        ink={INK_3}
        rule={RULE}
        band={JOURNAL_SURFACES.DATA_BAND}
        line={COBALT}
        accent={CORAL}
        label={title}
        onInspect={setInspect}
      />
      <Link
        to={storyHrefFor(selected.slug)}
        className={`seed-control seed-focus flex items-center justify-between ${wide ? "mt-5" : "mt-3"}`}
        style={{
          minHeight: 48, paddingInline: 18, background: FOREST, color: IVORY,
          fontSize: 14, textDecoration: "none",
        }}
      >
        <span style={{ fontFamily: "var(--font-interface)", fontSize: 15.5, letterSpacing: "0.01em" }}>
          Read this day
        </span>
        <span aria-hidden="true" style={{ fontSize: 15, opacity: 0.85 }}>→</span>
      </Link>
    </>
  );

  return (
    <div
      className={`${theme.className} ${typeface.className} flex h-dvh w-full flex-col overflow-hidden`}
      style={{ background: IVORY, color: INK }}
    >
      <JournalHeader compact={!wide} />

      {wide ? (
      /* ------------------------------- Desktop ------------------------------ */
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "minmax(0,0.94fr) minmax(0,1.06fr)" }}>
        {/* ---------------------------- Left leaf --------------------------- */}
        <section className="flex min-h-0 flex-col" style={{ borderRight: `1px solid ${RULE}` }}>
          {regionHeader("px-10", 46)}
          {daysHeading("px-10")}
          {days("px-10")}
        </section>

        {/* ---------------------------- Right leaf -------------------------- */}
        <section className="flex min-h-0 flex-col" style={{ background: PLATE_FIELD }}>
          <figure className="m-0 flex min-h-0 flex-1 flex-col" style={{ padding: "30px 40px 0" }}>
            {plate}
            {caption}
          </figure>
          <div style={{ padding: "18px 40px 28px" }}>{climbAndAction}</div>
        </section>
      </div>

      ) : (
      /* -------------------------------- Narrow ----------------------------- */
      /*
       * The same leaves, stacked, on a page that scrolls.
       *
       * This surface is for choosing a day, so the days get the screen. The
       * geographic introduction stays - a compact plate with its framing
       * control, the selected day's title, and its climb - but it scrolls away
       * rather than holding the viewport, and the column heading sticks so an
       * intermediate position still says what you are looking at. Previously
       * the preview was pinned and the list was a 153px inner scroller, which
       * is not a list you can browse.
       */
      <div
        ref={scrollRef as RefObject<HTMLDivElement>}
        onScroll={trackEdge}
        data-at-end={atEnd ? "true" : "false"}
        data-journal-scroller="true"
        className="seed-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {regionHeader("px-5", 34)}
        <section style={{ background: PLATE_FIELD, borderTop: `1px solid ${RULE}` }}>
          <figure className="m-0 flex flex-col" style={{ padding: "12px 20px 0" }}>
            {/* A fixed share of the screen, so a 233-character caption can
                never take the geography's height. */}
            <div className="flex flex-col" style={{ height: "27vh", minHeight: 196 }}>{plate}</div>
            {caption}
          </figure>
          <div style={{ padding: "10px 20px 16px" }}>{climbAndAction}</div>
        </section>
        {daysHeading("px-5")}
        {days("px-5")}
      </div>
      )}
    </div>
  );
}
