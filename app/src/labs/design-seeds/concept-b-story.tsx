import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { SeedTerrain } from "@/labs/design-seeds/seed-terrain";
import { SeedElevation } from "@/labs/design-seeds/seed-elevation";
import { SeedTraceMark } from "@/labs/design-seeds/seed-profile";
import {
  activityLabel, climbLabel, distanceLabel, effortLine, evidenceFootnote,
  guideAttribution, isExpressiveTitle, isMemory, movingTime, personalTitle,
  readableDate, replayActionLabel, routeNote,
} from "@/labs/design-seeds/seed-content";
import {
  JOURNAL, JOURNAL_SURFACES, PLATE_PADDING, type SeedTheme, type SeedTypeface,
} from "@/labs/design-seeds/concept-b-tokens";
import { useWideLayout } from "@/labs/design-seeds/seed-media";
import type { QuestRoute } from "@/domain/route";

/* =============================================================================
   B - THE DAY
   The Atlas is for browsing; this page is for entering a day.

   Composition, deliberately NOT the Atlas arrangement:
     - The Atlas is list | framed plate | chart | button.
     - The day is an entry column of prose beside UNFRAMED geography that runs
       floor to ceiling. Losing the frame is the signal that you are inside the
       place rather than looking at a plate of it.
     - The elevation is a fine strip along the geography's lower edge, not a
       separate chart, and Replay sits inside the geography column so entering
       it continues the same object rather than submitting a form.
   ========================================================================== */

const { IVORY, INK, INK_2, INK_3, RULE, FOREST, COBALT, CORAL } = JOURNAL;

/**
 * Where a note stops being a caption.
 *
 * Roughly two lines at the introduction's measure. Below it the note groups
 * under the title; above it, it wants a column of its own. Derived from the
 * composition rather than from any particular route, so no route is a special
 * case and nothing is ever shortened to fit.
 */
const CAPTION_LIMIT = 120;

/** Title sizing. Her wording and capitalisation are never altered. */
function titleType(title: string, expressive: boolean) {
  if (expressive) return { size: 46, leading: 1.08, face: "var(--font-interface)" };
  if (title.length <= 40) return { size: 44, leading: 1.06, face: "var(--font-editorial)" };
  if (title.length <= 96) return { size: 32, leading: 1.16, face: "var(--font-editorial)" };
  // A 233-character title is a sentence, not a headline. Set as a standfirst:
  // large enough to be the voice of the page, small enough to stay a paragraph.
  return { size: 21, leading: 1.5, face: "var(--font-editorial)" };
}

/**
 * The recorded details.
 *
 *  - `column`  a colophon beneath prose: label left, value right.
 *  - `stacked` the narrow note page, two columns.
 *  - `row`     a single horizontal readout, used by the sparse composition.
 *
 * `row` exists because 57 of 68 routes have no note, and the earlier answer -
 * the same table set larger - filled a tall column with five facts and left
 * the rest of it blank. Read across in one line the details introduce the day
 * without pretending to be prose, and the geography gets the space back.
 *
 * Values are measurements, so they are set in the interface family with
 * tabular figures.
 */
function Facts({
  route, variant = "column",
}: {
  route: QuestRoute;
  variant?: "column" | "stacked" | "row";
}) {
  const stacked = variant === "stacked";
  const row = variant === "row";
  const time = movingTime(route);
  const rows: [string, string][] = [
    ["Distance", distanceLabel(route.distanceKm)],
    ["Ascent", climbLabel(route.elevationGainM)],
    ...(time ? ([["Elapsed", time]] as [string, string][]) : []),
    ["Activity", activityLabel(route)],
    ["Character", effortLine(route)],
  ];
  if (row) {
    return (
      <dl className="flex flex-wrap" style={{ columnGap: 34, rowGap: 16, margin: 0 }}>
        {rows.map(([term, value]) => (
          <div key={term} style={{ minWidth: 0 }}>
            <dt
              style={{
                fontFamily: "var(--font-interface)", fontSize: 10.5,
                letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3,
              }}
            >
              {term}
            </dt>
            <dd
              style={{
                fontFamily: "var(--font-interface)", fontVariantNumeric: "tabular-nums",
                fontSize: 19, lineHeight: 1.25, color: INK, marginTop: 5, marginLeft: 0,
                whiteSpace: "nowrap",
              }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className={stacked ? "grid grid-cols-2" : "grid"}
      style={{
        gridTemplateColumns: stacked ? undefined : "auto 1fr",
        columnGap: stacked ? 16 : 22,
        rowGap: stacked ? 14 : 7,
      }}
    >
      {rows.map(([term, value]) => (
        <div key={term} className={stacked ? "" : "contents"}>
          <dt
            style={{
              fontFamily: "var(--font-interface)", fontSize: 11,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: INK_3, alignSelf: "baseline",
            }}
          >
            {term}
          </dt>
          <dd
            style={{
              fontFamily: "var(--font-interface)",
              fontVariantNumeric: "tabular-nums",
              fontSize: stacked ? 17 : 15,
              color: INK, marginTop: stacked ? 3 : 0,
            }}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The owner's voice, framed - never manufactured.
 *
 * When nothing was saved this renders nothing at all. An earlier version filled
 * the gap with "You left no note this day. What survives is the line, and what
 * it cost." - atmospheric prose the product wrote on Lauren's behalf, which is
 * exactly the thing it must not do. 58 of 68 routes have no note, so the page
 * has to be complete without one: the title, the date, the geography and the
 * details already carry it.
 *
 * The personal/imported distinction is kept in the byline, which stays a quiet
 * source line rather than interface prose.
 */
function Note({ route, size = 26 }: { route: QuestRoute; size?: number }) {
  const { body, own } = routeNote(route);
  if (!body) return null;

  return (
    <section>
      <p
        style={{
          // The note is prose, the titles are display. `--font-prose` lets the
          // two roles be set independently; unset it and prose follows the
          // editorial family, so the single-family options are unaffected.
          fontFamily: "var(--font-prose, var(--font-editorial))",
          fontSize: size,
          lineHeight: 1.44,
          color: INK,
          letterSpacing: "0.003em",
        }}
      >
        {body}
      </p>
      <p
        style={{
          marginTop: 14, fontSize: 11, letterSpacing: "0.14em",
          textTransform: "uppercase", color: INK_3,
        }}
      >
        <span aria-hidden="true" style={{ paddingRight: 8 }}>—</span>
        {own ? "What you wrote that day" : guideAttribution(route)}
      </p>
    </section>
  );
}

/** Real photographs when they exist, never a stand-in when they do not. */
function Photograph({ route }: { route: QuestRoute }) {
  const photo = route.annotations?.find((item) => item.kind === "image" && item.media);
  if (!photo?.media) return null;
  return (
    <figure className="m-0" style={{ marginTop: 30, borderTop: `1px solid ${RULE}`, paddingTop: 18 }}>
      <img
        src={`/${photo.media.url}`}
        alt={photo.body}
        width={photo.media.width}
        height={photo.media.height}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
      <figcaption style={{ fontSize: 12.5, color: INK_2, lineHeight: 1.5, marginTop: 10 }}>
        {photo.title ? <strong style={{ fontWeight: 600, color: INK }}>{photo.title}. </strong> : null}
        {photo.body}
        <span style={{ color: INK_3 }}>
          {" "}Taken {Math.round(photo.atDistanceM / 100) / 10} km in.
        </span>
      </figcaption>
    </figure>
  );
}

export function ConceptBStory({
  route,
  backPath,
  backLabel,
  replayHref,
  openFromAtlas,
  theme,
  typeface,
}: {
  route: QuestRoute;
  backPath: string;
  backLabel: string;
  replayHref: string;
  /** True when we arrived from the Atlas, so the camera can hand the line over. */
  openFromAtlas: boolean;
  /** Colour only. Layout, type, content and framing do not vary by theme. */
  theme: SeedTheme;
  /** Editorial family only. Sizes, weights and labels do not vary by face. */
  typeface: SeedTypeface;
}) {
  const [inspect, setInspect] = useState<number>();
  const wide = useWideLayout(1024);
  const title = personalTitle(route);
  const expressive = isExpressiveTitle(route);
  const type = titleType(title, expressive);
  const footnote = evidenceFootnote(route);
  const longTitle = title.length > 96;

  /*
   * Which composition does this day's content want?
   *
   * Two, not three. The reading column exists for a page you settle into: a
   * photograph to look at, or prose long enough to be a paragraph. Everything
   * else - no note at all, or a note of a sentence or two - gets the compact
   * introduction with the geography full width, because a full-height column
   * holding fourteen characters ("it was fun tho") is the same reserved-empty
   * rectangle as a column holding nothing.
   *
   * The threshold is a property of the composition, not of any route: past
   * roughly two lines at the introduction's measure a note stops reading as a
   * caption under the title and starts asking to be read on its own. It is
   * checked against the note, so nothing is truncated and no route is named.
   */
  const note = routeNote(route);
  const hasPhotograph = Boolean(
    route.annotations?.some((item) => item.kind === "image" && item.media),
  );
  const column = hasPhotograph || note.body.length > CAPTION_LIMIT;

  const summaryLike = useMemo(
    () => ({ ...route, trace: route.route }) as unknown as import("@/domain/route").RouteSummary,
    [route],
  );

  /*
   * Bring the whole inspection unit into view when scrubbing starts.
   *
   * On a phone the geography and the climb are stacked, so it is possible to be
   * scrolled with only the curve on screen and the corresponding map position
   * above the fold. This scrolls the pair together, and only when it is not
   * already fully visible, so it never yanks the page out from under a reader
   * who can already see both.
   */
  const inspectionRef = useRef<HTMLDivElement>(null);
  const inspecting = inspect !== undefined;
  useEffect(() => {
    if (!inspecting || wide) return;
    const node = inspectionRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const top = 52; // the sticky return header
    if (box.top >= top && box.bottom <= window.innerHeight) return;
    node.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [inspecting, wide]);

  /*
   * The camera is framed for the pane it is given, not for a nominal one.
   *
   * A day with prose puts the map in a tall 62.5% column, where the route's
   * width is the binding constraint. The sparse composition gives it the full
   * width and about 600px of height, where the height binds instead - and the
   * generous padding written for the tall pane left Banff's route occupying
   * barely half the available height with empty valley above and below. So the
   * wide sparse pane trades vertical padding for horizontal, and drops the
   * context zoom-out, letting the recorded line be as large as the pane allows
   * while the extra width still reads as the country around it.
   */
  const wideSparse = wide && !column;
  const geography = (
    <SeedTerrain
      routes={[summaryLike]}
      selectedSlug={route.slug}
      tone="journal"
      cartography={theme.cartography}
      focusSelected
      padding={
        wideSparse
          ? { top: 40, right: 88, bottom: 40, left: 88 }
          : { top: 72, right: 64, bottom: 72, left: 64 }
      }
      contextZoomOut={wideSparse ? 0 : 0.15}
      openFrom={openFromAtlas ? PLATE_PADDING : undefined}
      markerProgress={inspect}
      attributionPosition="top-left"
    />
  );

  const elevation = (
    <SeedElevation
      points={route.route}
      totalAscentM={route.elevationGainM}
      height={92}
      ink={INK_3}
      rule={JOURNAL_SURFACES.RULE_SOFT}
      band={JOURNAL_SURFACES.DATA_BAND}
      line={COBALT}
      accent={CORAL}
      label={title}
      onInspect={setInspect}
      showAscent={false}
    />
  );

  const replay = (
    <Link
      to={replayHref}
      className="seed-control seed-focus flex items-center justify-between"
      style={{
        minHeight: 52, paddingInline: 20, background: FOREST, color: IVORY,
        textDecoration: "none",
      }}
    >
      <span style={{ fontFamily: "var(--font-interface)", fontSize: 16.5, letterSpacing: "0.01em" }}>
        {replayActionLabel(route)}
      </span>
      <span aria-hidden="true" style={{ fontSize: 15, opacity: 0.85 }}>▶</span>
    </Link>
  );

  /*
   * Evidence and absence in one quiet line, in the small print where the
   * recording's caveats already live. "No note saved." is a fact about the
   * archive, not the subject of the page, and it is set to be found rather
   * than to be read first.
   */
  const smallPrint = [footnote, note.body ? null : "No note saved."]
    .filter(Boolean)
    .join(" · ");

  const dateline = (size: "wide" | "narrow") => (
    <p
      style={{
        fontFamily: "var(--font-interface)", fontSize: 11,
        letterSpacing: size === "wide" ? "0.2em" : "0.18em",
        textTransform: "uppercase", color: INK_3, lineHeight: size === "wide" ? 1.6 : 1.7,
      }}
    >
      {route.region}
      <span aria-hidden="true" style={{ paddingInline: size === "wide" ? 8 : 7, color: RULE }}>/</span>
      {readableDate(route.date)}
    </p>
  );

  const imported = !isMemory(route) ? (
    <p style={{ marginTop: 12, fontSize: 12.5, color: INK_2 }}>
      An imported route. You have not run this one.
    </p>
  ) : null;

  return (
    <div
      className={`${theme.className} ${typeface.className} min-h-dvh w-full`}
      style={{ background: IVORY, color: INK }}
      data-navigation-window-scroll="managed"
    >
      {/* Quiet return. The label names the place, not the surface. */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-5 lg:px-8"
        style={{
          height: 52, background: JOURNAL_SURFACES.PAPER_VEIL,
          borderBottom: `1px solid ${RULE}`, backdropFilter: "blur(8px)",
        }}
      >
        <Link
          to={backPath}
          className="seed-control seed-focus inline-flex items-center"
          style={{ fontSize: 13.5, gap: 8, color: INK, textDecoration: "none" }}
        >
          <span aria-hidden="true">←</span> {backLabel}
        </Link>
        {/* The route's shape travels with it, at a whisper. */}
        <SeedTraceMark
          points={route.route}
          stroke={CORAL}
          strokeWidth={1.5}
          className="seed-miniature size-7"
          label={title}
        />
      </header>

      {wide && column ? (
      /* ------------------ Desktop, a day with something to read ------------ */
      <div>
        <article
          className="seed-scroll"
          style={{
            position: "fixed", left: 0, top: 52, bottom: 0, width: "37.5%",
            overflowY: "auto", padding: "44px 44px 40px",
            borderRight: `1px solid ${RULE}`, background: IVORY,
            display: "flex", flexDirection: "column",
          }}
        >
          {dateline("wide")}
          <h1
            style={{
              fontFamily: type.face, fontWeight: 600, fontSize: type.size,
              lineHeight: type.leading, marginTop: 16, marginBottom: 0, color: INK,
              letterSpacing: expressive ? 0 : "0.005em",
            }}
          >
            {title}
          </h1>
          {imported}
          <div style={{ marginTop: 28 }}>
            <Note route={route} />
          </div>
          <Photograph route={route} />
          <div style={{ marginTop: "auto", paddingTop: 40 }}>
            <section style={{ borderTop: `1px solid ${RULE}`, paddingTop: 18 }}>
              <Facts route={route} />
            </section>
            {smallPrint ? (
              <p style={{ fontSize: 11.5, color: INK_3, lineHeight: 1.5, marginTop: 16 }}>
                {smallPrint}
              </p>
            ) : null}
          </div>
        </article>

        {/*
          Unframed geography, floor to ceiling, with the climb along its lower
          edge and Replay as the last thing in the same column.

          The plate is a flex child with min-height 0, the same structure the
          Atlas leaf uses and the only one that renders reliably here. As an
          absolutely-positioned layer in a tall pane the map painted just its
          lower 607px of an 848px canvas, with the canvas, GL drawing buffer
          and transform all reporting 848 - so the footer sits in flow instead
          of floating over it.
        */}
        <div
          className="flex flex-col"
          style={{ position: "fixed", right: 0, top: 52, bottom: 0, width: "62.5%" }}
        >
          {/*
            DOM order puts the climb and Replay before the map, and flex `order`
            puts the map above them on screen. Measured otherwise: MapLibre's
            required attribution added four tab stops ahead of the page's two
            primary controls, so a keyboard user reached the credit before the
            inspection or Replay.
          */}
          <div
            style={{
              order: 2, flex: "0 0 auto", padding: "16px 28px 20px",
              background: IVORY, borderTop: `1px solid ${RULE}`,
            }}
          >
            {elevation}
            <div style={{ paddingTop: 16 }}>{replay}</div>
          </div>
          <div className="relative" style={{ order: 1, flex: "1 1 auto", minHeight: 0 }}>
            {geography}
          </div>
        </div>
      </div>

      ) : wide ? (
      /* --------------------- Desktop, a day of geography ------------------- */
      /*
       * Same page, no prose column. The introduction is a band the height of
       * its own content - the date, the title she gave the day, a note of a
       * sentence or two when there is one, and the recorded details read
       * across in one line - and everything below it is the place: the route
       * full width, the climb along its lower edge, and Replay in the same
       * column, exactly as on a day with a reading column.
       *
       * The band grows to hold what is there and stops. It is the same
       * composition whether the note is absent or short, so a fourteen-word
       * memory is grouped with its title rather than stranded at the top of a
       * column the height of the window.
       *
       * Fixed insets rather than a calc-sized grid row, for the same reason as
       * above: the map needs an unambiguous height from first layout.
       */
      <div
        className="flex flex-col"
        style={{ position: "fixed", inset: "52px 0 0 0", overflowY: "auto" }}
      >
        <section
          style={{
            flex: "0 0 auto", padding: "30px 44px 26px",
            borderBottom: `1px solid ${RULE}`, background: IVORY,
          }}
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: longTitle ? "minmax(0,1fr)" : "minmax(0,1fr) auto",
              columnGap: 56, rowGap: 24, alignItems: "end",
            }}
          >
            <div style={{ minWidth: 0 }}>
              {dateline("wide")}
              <h1
                style={{
                  fontFamily: type.face, fontWeight: 600, fontSize: type.size,
                  lineHeight: type.leading, marginTop: 14, marginBottom: 0, color: INK,
                  letterSpacing: expressive ? 0 : "0.005em",
                  // A 233-character title set across the whole band would run to
                  // about 150 characters a line. Titles short enough to be
                  // headlines keep the full width; a title that is really a
                  // sentence gets a measure it can be read at.
                  maxWidth: longTitle ? 1120 : undefined,
                }}
              >
                {title}
              </h1>
              {imported}
              {note.body ? (
                <div style={{ marginTop: 20, maxWidth: 680 }}>
                  <Note route={route} size={24} />
                </div>
              ) : null}
            </div>
            <Facts route={route} variant="row" />
          </div>
        </section>

        <div
          className="relative"
          style={{ flex: "1 1 auto", minHeight: 260 }}
        >
          {geography}
        </div>

        <div
          style={{
            flex: "0 0 auto", padding: "16px 28px 20px",
            background: IVORY, borderTop: `1px solid ${RULE}`,
          }}
        >
          {elevation}
          {smallPrint ? (
            <p style={{ fontSize: 11.5, color: INK_3, lineHeight: 1.5, marginTop: 12 }}>
              {smallPrint}
            </p>
          ) : null}
          <div style={{ paddingTop: 14 }}>{replay}</div>
        </div>
      </div>

      ) : (
      /* -------------------------------- Narrow ----------------------------- */
      <div>
        <div className="px-5" style={{ paddingTop: 24 }}>
          {dateline("narrow")}
          <h1
            style={{
              fontFamily: type.face, fontWeight: 600,
              fontSize: Math.min(type.size, longTitle ? 18 : 34),
              lineHeight: longTitle ? 1.48 : 1.1,
              marginTop: 8, color: INK,
            }}
          >
            {title}
          </h1>
          {imported}
          {column ? null : (
            <>
              {note.body ? (
                <div style={{ marginTop: 18 }}>
                  <Note route={route} size={21} />
                </div>
              ) : null}
              {/* The same readout as the wide band, wrapped to the column, so
                  the introduction is complete before the geography arrives. */}
              <div style={{ marginTop: 18, borderTop: `1px solid ${RULE}`, paddingTop: 16 }}>
                <Facts route={route} variant="row" />
              </div>
            </>
          )}
        </div>

        {/*
          Geography and climb are one inspection unit, and Replay sits in flow
          directly beneath them.

          The action used to be a fixed bar pinned to the bottom of the screen,
          which put the lower third of the elevation curve - and with it the
          playhead and the distance/altitude readout - underneath itself while
          you were scrubbing. Measured at 390x844: the bar's top edge sat at
          776px with the chart running past it. An in-flow action cannot
          overlap anything, and the pair is sized to fit one screen together so
          the marker on the map and the readout on the curve are read at once.
        */}
        <div ref={inspectionRef} style={{ scrollMarginTop: 52 }}>
          <div
            className="relative"
            style={{ height: "42vh", minHeight: 280, marginTop: column ? 22 : 18 }}
          >
            <div className="absolute inset-0">{geography}</div>
          </div>
          <div className="px-5" style={{ paddingTop: 14 }}>{elevation}</div>
          <div className="px-5" style={{ paddingTop: 16 }}>{replay}</div>
        </div>

        {column ? (
          <div className="px-5" style={{ paddingTop: 26, display: "grid", gap: 24 }}>
            <Note route={route} size={23} />
            <Photograph route={route} />
            <section style={{ borderTop: `1px solid ${RULE}`, paddingTop: 18 }}>
              <Facts route={route} variant="stacked" />
            </section>
            {smallPrint ? (
              <p style={{ fontSize: 11.5, color: INK_3, lineHeight: 1.5 }}>{smallPrint}</p>
            ) : null}
          </div>
        ) : smallPrint ? (
          <p
            className="px-5"
            style={{ fontSize: 11.5, color: INK_3, lineHeight: 1.5, paddingTop: 18 }}
          >
            {smallPrint}
          </p>
        ) : null}

        <div aria-hidden="true" style={{ height: "calc(28px + var(--safe-area-bottom))" }} />
      </div>
      )}
    </div>
  );
}
