import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { SeedReliefMap } from "@/labs/design-seeds/seed-relief-map";
import { SeedTraceMark } from "@/labs/design-seeds/seed-profile";
import { useWideLayout } from "@/labs/design-seeds/seed-media";
import { useJournalPosition } from "@/labs/design-seeds/seed-return-context";
import { JOURNAL, JOURNAL_SURFACES } from "@/labs/design-seeds/concept-b-tokens";
import {
  activityLabel, climbLabel, coverageLine, distanceLabel, effortLine,
  isExpressiveTitle, personalTitle, readableDate, routeNote, totalDistanceLabel,
} from "@/labs/design-seeds/seed-content";
import type { RouteSummary } from "@/domain/route";

/* =============================================================================
   D - THE CARRIED NOTEBOOK: the region

   One landform, every day drawn on it, and the notebook open beside it.

   The baseline showed a list of days next to a plate of one route at a time.
   Eight visits to Crete were eight pictures. Here they are one picture: the
   whole recorded collection is on the landform at once, the chosen day lifts
   out of it in terracotta, and choosing another flies the camera across the
   same terrain instead of cutting to a new plate. That is what makes a region
   read as a place returned to.
   ========================================================================== */

const { IVORY, INK, INK_2, INK_3, RULE, FOREST, CORAL, CORAL_TEXT } = JOURNAL;
const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const LONG_TITLE = 96;

function Entry({
  route, active, href, onSelect, wide,
}: {
  route: RouteSummary;
  active: boolean;
  href: string;
  onSelect: () => void;
  wide: boolean;
}) {
  const title = personalTitle(route);
  const expressive = isExpressiveTitle(route);
  const long = title.length > LONG_TITLE;
  const month = new Date(`${route.date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

  const content = (
    <>
      <span className="self-start" style={{ paddingTop: 2 }}>
        <span className="block" style={{ ...NUM, fontSize: 19, lineHeight: 1, color: active ? CORAL_TEXT : INK }}>
          {route.date.slice(8, 10)}
        </span>
        <span
          className="block"
          style={{
            fontFamily: "var(--font-interface)", fontSize: 10.5, letterSpacing: "0.1em",
            textTransform: "uppercase", color: active ? CORAL_TEXT : INK_3, marginTop: 4,
          }}
        >
          {month} {route.date.slice(2, 4)}
        </span>
      </span>
      <span className="min-w-0 self-start">
        <span
          className="block"
          data-journal-title=""
          style={{
            fontFamily: expressive ? "var(--font-interface)" : "var(--font-editorial)",
            fontSize: expressive ? 22 : long ? 17 : 20,
            lineHeight: long ? 1.32 : 1.24, color: INK,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}
        >
          {title}
        </span>
        <span
          className="mt-2 block"
          style={{ ...NUM, fontFamily: "var(--font-interface)", fontSize: 11, color: INK_2, letterSpacing: "0.01em" }}
        >
          {activityLabel(route)} · {distanceLabel(route.distanceKm)} ·{" "}
          {climbLabel(route.elevationGainM)} · {effortLine(route)}
        </span>
      </span>
      <SeedTraceMark
        points={route.trace}
        stroke={active ? CORAL : JOURNAL_SURFACES.MINIATURE}
        strokeWidth={active ? 1.9 : 1.15}
        className="seed-miniature size-11 self-start"
        style={{ opacity: active ? 1 : 0.7 }}
        label={title}
      />
    </>
  );

  const shape = {
    gridTemplateColumns: "48px minmax(0,1fr) 44px",
    columnGap: 16,
    minHeight: 78,
    paddingBlock: 13,
    paddingInline: "12px 0",
  } as const;

  return (
    <li style={{ borderTop: `1px solid ${RULE}` }}>
      {/*
        On a phone the entry is a link straight into the day. On desktop it
        selects, because selecting is what moves the camera across the landform
        beside it - the whole reason the collection view exists.
      */}
      {wide ? (
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className="seed-row seed-focus relative grid w-full items-baseline text-left"
          style={shape}
        >
          {content}
        </button>
      ) : (
        <Link
          to={href}
          aria-current={active ? "true" : undefined}
          className="seed-row seed-focus relative grid w-full items-baseline text-left"
          style={{ ...shape, color: INK, textDecoration: "none" }}
        >
          {content}
        </Link>
      )}
    </li>
  );
}

export function ConceptDAtlas({
  region, routes, selected, onSelect, storyHrefFor, returnKey,
}: {
  region: string;
  routes: RouteSummary[];
  selected: RouteSummary;
  onSelect: (slug: string) => void;
  storyHrefFor: (slug: string) => string;
  returnKey: string;
}) {
  const wide = useWideLayout(1024);
  const scrollRef = useRef<HTMLElement>(null);
  const positionRestored = useJournalPosition(returnKey, scrollRef);
  const [wholeRegion, setWholeRegion] = useState(true);

  const ordered = useMemo(
    () => [...routes].sort((a, b) => a.date.localeCompare(b.date)),
    [routes],
  );
  const first = ordered[0]?.date ?? "";
  const last = ordered[ordered.length - 1]?.date ?? "";
  const title = personalTitle(selected);
  const note = routeNote(selected as never);

  // The store restores the reading position; consume the flag so nothing else
  // moves the list on arrival.
  if (positionRestored.current) positionRestored.current = false;

  const geography = (
    <SeedReliefMap
      routes={ordered}
      selectedSlug={selected.slug}
      focusSelected={!wholeRegion}
      onSelect={onSelect}
      /*
       * Pitched even on the overview. A region of recorded days is a landscape,
       * and eight lines lying across modelled terrain say "the same hills, many
       * times" in a way eight lines on a flat plate cannot.
       */
      /*
       * Gently pitched, not dramatically. At 40 degrees the far end of Crete
       * foreshortened until the days recorded there were unreadable, and the
       * collection is the point of this view.
       */
      pitch={wide ? 26 : 22}
      padding={
        wide
          ? { top: 160, right: 110, bottom: 130, left: 510 }
          /* The sheet covers the lower half; frame into the visible band. */
          : { top: 84, right: 30, bottom: 496, left: 30 }
      }
    />
  );

  const heading = (
    <div style={{ paddingBottom: 18 }}>
      <div
        style={{
          fontFamily: "var(--font-interface)", fontSize: 10.5, letterSpacing: "0.2em",
          textTransform: "uppercase", color: INK_3,
        }}
      >
        {region}
      </div>
      <h1
        style={{
          fontFamily: "var(--font-editorial)", fontWeight: 600,
          fontSize: wide ? 44 : 32, lineHeight: 1.02, marginTop: 8, letterSpacing: "0.005em",
        }}
      >
        {region.split(",")[0]}
      </h1>
      <p style={{ ...NUM, fontFamily: "var(--font-interface)", marginTop: 10, fontSize: 12.5, color: INK_2, lineHeight: 1.5 }}>
        {routes.length} recorded days · {readableDate(first)} – {readableDate(last)}
        <br />
        {totalDistanceLabel(routes)} {coverageLine(routes)}
      </p>
    </div>
  );

  /* The chosen day, held open in the notebook next to its line on the land. */
  const chosen = (
    <div style={{ borderTop: `1px solid ${RULE}`, paddingTop: 16, paddingBottom: 18 }}>
      <div
        style={{
          fontFamily: "var(--font-interface)", fontSize: 10.5, letterSpacing: "0.16em",
          textTransform: "uppercase", color: CORAL_TEXT,
        }}
      >
        {readableDate(selected.date)}
      </div>
      <div
        style={{
          fontFamily: isExpressiveTitle(selected) ? "var(--font-interface)" : "var(--font-editorial)",
          fontSize: title.length > LONG_TITLE ? 16 : 24,
          lineHeight: title.length > LONG_TITLE ? 1.4 : 1.2,
          marginTop: 8, color: INK,
        }}
      >
        {title}
      </div>
      {note.body ? (
        <p
          style={{
            fontFamily: "var(--font-prose, var(--font-editorial))",
            fontSize: 18, lineHeight: 1.42, marginTop: 10, color: INK_2,
          }}
        >
          {note.body.length > 150 ? `${note.body.slice(0, 150).trimEnd()}…` : note.body}
        </p>
      ) : null}
      <Link
        to={storyHrefFor(selected.slug)}
        className="seed-control seed-focus mt-4 flex items-center justify-between"
        style={{
          minHeight: 48, paddingInline: 18, background: FOREST, color: IVORY,
          textDecoration: "none",
        }}
      >
        <span style={{ fontFamily: "var(--font-interface)", fontSize: 15.5, letterSpacing: "0.01em" }}>
          Enter this day
        </span>
        <span aria-hidden="true" style={{ fontSize: 15, opacity: 0.85 }}>→</span>
      </Link>
    </div>
  );

  const days = (
    <ol style={{ paddingBottom: 24 }}>
      {ordered.map((route) => (
        <Entry
          key={route.slug}
          route={route}
          active={route.slug === selected.slug}
          href={storyHrefFor(route.slug)}
          onSelect={() => onSelect(route.slug)}
          wide={wide}
        />
      ))}
    </ol>
  );

  const framing = (
    <div
      role="group"
      aria-label="Landform framing"
      className="seed-leaf pointer-events-auto flex overflow-hidden"
    >
      {([[true, "The whole visit"], [false, "This day"]] as const).map(([value, text]) => (
        <button
          key={text}
          type="button"
          onClick={() => setWholeRegion(value)}
          aria-pressed={wholeRegion === value}
          className="seed-control seed-focus"
          style={{
            paddingInline: 14, fontFamily: "var(--font-interface)", fontSize: 12,
            border: 0,
            background: wholeRegion === value ? FOREST : "transparent",
            color: wholeRegion === value ? IVORY : INK_2,
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="seed-theme-journal seed-type-role relative h-dvh w-full overflow-hidden"
      style={{ background: IVORY, color: INK }}
    >
      <div className="absolute inset-0">{geography}</div>

      <div className="pointer-events-none absolute right-4 top-4 z-30">{framing}</div>

      {wide ? (
        <aside
          ref={scrollRef as React.RefObject<HTMLElement>}
          data-journal-scroller="true"
          className="seed-leaf seed-scroll absolute z-20 overflow-y-auto"
          style={{ left: 0, top: 0, bottom: 0, width: 456, padding: "34px 40px 30px" }}
        >
          {heading}
          {chosen}
          <div
            className="sticky top-0 z-10 flex items-baseline justify-between"
            style={{
              height: 32, background: "var(--seed-paper-veil)",
              borderBottom: `1px solid ${RULE}`, fontFamily: "var(--font-interface)",
              fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3,
            }}
          >
            <span>The days</span>
            <span style={{ letterSpacing: "0.08em" }}>oldest first</span>
          </div>
          {days}
        </aside>
      ) : (
        <div
          ref={scrollRef as React.RefObject<HTMLDivElement>}
          data-journal-scroller="true"
          className="seed-leaf-sheet seed-scroll absolute inset-x-0 z-20 overflow-y-auto"
          style={{ bottom: 0, top: "46%", padding: "0 20px calc(22px + var(--safe-area-bottom))" }}
        >
          <div style={{ paddingTop: 18 }}>{heading}</div>
          <div
            className="sticky top-0 z-10 flex items-baseline justify-between"
            style={{
              height: 32, background: "var(--seed-paper-veil)",
              borderBottom: `1px solid ${RULE}`, fontFamily: "var(--font-interface)",
              fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3,
            }}
          >
            <span>The days</span>
            <span style={{ letterSpacing: "0.08em" }}>oldest first</span>
          </div>
          {days}
        </div>
      )}
    </div>
  );
}
