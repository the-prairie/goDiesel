import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Compass } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { SeedReliefMap, type ThreadPhoto } from "@/labs/design-seeds/seed-relief-map";
import { SeedRibbon } from "@/labs/design-seeds/seed-ribbon";
import { RELIEF_PALETTE } from "@/labs/design-seeds/seed-relief";
import { useWideLayout } from "@/labs/design-seeds/seed-media";
import { JOURNAL, JOURNAL_SURFACES } from "@/labs/design-seeds/concept-b-tokens";
import {
  activityLabel, climbLabel, distanceLabel, effortLine, evidenceFootnote,
  guideAttribution, isExpressiveTitle, isMemory, movingTime, personalTitle,
  readableDate, routeNote,
} from "@/labs/design-seeds/seed-content";
import { recordedPointAt } from "@/domain/geometry/recorded-thread";
import { readDayContext, writeDayContext } from "@/labs/design-seeds/seed-day-context";
import { useJournalPosition } from "@/labs/design-seeds/seed-return-context";
import type { ReliefState } from "@/ui/maps/relief-world";
import type { QuestRoute, RouteSummary } from "@/domain/route";

/* =============================================================================
   D - THE CARRIED NOTEBOOK: the day

   The geography is the page. The notebook is a leaf resting on it.

   The baseline gave the day a reading column beside a map. That is a good
   layout and a poor claim: it says the place is an illustration next to the
   text. Here the modelled landform fills the surface, the notebook lies over
   it, and the reader can push the notebook aside - so the day is somewhere you
   are, with a page open on it.
   ========================================================================== */

const { IVORY, INK, INK_2, INK_3, RULE, FOREST, CORAL } = JOURNAL;

const CAPTION_LIMIT = 120;

/** Her wording and capitalisation are never altered. */
function titleType(title: string, expressive: boolean) {
  if (expressive) return { size: 44, leading: 1.08, face: "var(--font-interface)" };
  if (title.length <= 40) return { size: 42, leading: 1.06, face: "var(--font-editorial)" };
  if (title.length <= 96) return { size: 30, leading: 1.16, face: "var(--font-editorial)" };
  return { size: 20, leading: 1.5, face: "var(--font-editorial)" };
}

function Facts({ route, row = false }: { route: QuestRoute; row?: boolean }) {
  const time = movingTime(route);
  const rows: [string, string][] = [
    ["Distance", distanceLabel(route.distanceKm)],
    ["Ascent", climbLabel(route.elevationGainM)],
    ...(time ? ([["Elapsed", time]] as [string, string][]) : []),
    ["Activity", activityLabel(route)],
    ["Character", effortLine(route)],
  ];
  return (
    <dl
      className={row ? "flex flex-wrap" : "grid grid-cols-2"}
      style={{ columnGap: row ? 30 : 16, rowGap: row ? 14 : 14, margin: 0 }}
    >
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
              fontSize: 18, lineHeight: 1.25, color: INK, marginTop: 4, marginLeft: 0,
              whiteSpace: row ? "nowrap" : undefined,
            }}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The owner's voice, framed - never manufactured. */
function Note({ route, size }: { route: QuestRoute; size: number }) {
  const { body, own } = routeNote(route);
  if (!body) return null;
  return (
    <section>
      <p
        style={{
          fontFamily: "var(--font-prose, var(--font-editorial))",
          fontSize: size, lineHeight: 1.44, color: INK, letterSpacing: "0.003em",
        }}
      >
        {body}
      </p>
      <p
        style={{
          marginTop: 12, fontFamily: "var(--font-interface)", fontSize: 10.5,
          letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3,
        }}
      >
        <span aria-hidden="true" style={{ paddingRight: 8 }}>—</span>
        {own ? "What you wrote that day" : guideAttribution(route)}
      </p>
    </section>
  );
}

export function ConceptDStory({
  route,
  regionRoutes,
  backPath,
  backLabel,
  replayHref,
  initialProgress,
}: {
  route: QuestRoute;
  /** The neighbours, so the landform keeps its collection behind this day. */
  regionRoutes: RouteSummary[];
  backPath: string;
  backLabel: string;
  /** Takes the entry distance in metres, so Replay begins where you were holding. */
  replayHref: (atMetres?: number) => string;
  initialProgress?: number;
}) {
  const wide = useWideLayout(1024);
  const navigate = useNavigate();
  const contextKey = `d-day|${route.slug}|${backPath}`;
  const saved = readDayContext(contextKey);
  const [progress, setProgress] = useState<number | undefined>(() => {
    const raw = initialProgress ?? saved?.progress;
    const total = route.route.at(-1)?.d ?? 0;
    return raw === undefined || !total ? undefined : (recordedPointAt(route.route, raw * total, route.provenance.discontinuities)?.d ?? 0) / total;
  });
  const [descending, setDescending] = useState(false);
  const [leafOpen, setLeafOpen] = useState(saved?.leafOpen ?? true);
  const [exploring, setExploring] = useState(false);
  const [terrainState, setTerrainState] = useState<ReliefState>("loading");
  const [selectedPhoto, setSelectedPhoto] = useState(saved?.photoUrl);
  const leafRef = useRef<HTMLElement | null>(null);
  useJournalPosition(`${contextKey}|${wide ? "wide" : "narrow"}`, leafRef);
  useEffect(() => {
    writeDayContext(contextKey, { leafOpen, progress, photoUrl: selectedPhoto });
  }, [contextKey, leafOpen, progress, selectedPhoto]);
  // Resolve Replay's lazy module while the reader is with the page, not during
  // the handover. The renderer still mounts only when Replay takes ownership.
  useEffect(() => { void import("@/surfaces/replay/replay-page"); }, []);

  const title = personalTitle(route);
  const expressive = isExpressiveTitle(route);
  const type = titleType(title, expressive);
  const footnote = evidenceFootnote(route);
  const note = routeNote(route);

  const summaryLike = useMemo(
    () => ({ ...route, trace: route.route }) as unknown as RouteSummary,
    [route],
  );
  /*
   * The neighbours stay on the landform, quietly. A day is not a place on its
   * own - it is one line across a place the reader has crossed before.
   */
  const withNeighbours = useMemo(() => {
    const others = regionRoutes.filter((candidate) => candidate.slug !== route.slug);
    return [summaryLike, ...others];
  }, [regionRoutes, route.slug, summaryLike]);

  /** Photographs at their recorded distances. Absent on 57 of 68 days. */
  const photos: ThreadPhoto[] = useMemo(
    () =>
      (route.annotations ?? [])
        .filter((item) => item.kind === "image" && item.media)
        .map((item) => ({
          atDistanceM: item.atDistanceM,
          title: item.title || "Photograph",
          url: `/${item.media!.url}`,
        })),
    [route.annotations],
  );

  const totalM = route.route.at(-1)?.d ?? 0;
  const at = progress === undefined ? null : recordedPointAt(route.route, progress * totalM, route.provenance.discontinuities);
  const inspect = (next: number | undefined) => {
    if (descending) return;
    let requested = next === undefined ? undefined : next * totalM;
    const gap = requested === undefined ? undefined : route.provenance.discontinuities.find(gap => requested! > gap.startD && requested! < gap.endD);
    if (gap && progress !== undefined) requested = next! > progress ? gap.endD : gap.startD;
    const point = requested === undefined ? null : recordedPointAt(route.route, requested, route.provenance.discontinuities);
    setProgress(point && totalM ? point.d / totalM : undefined);
  };
  const heldPhoto = useMemo(() => {
    if (!at || !photos.length) return null;
    /* Within 400 m of a recorded photograph, that photograph is what you are
       looking at. The distance comes from the file, not from a guess. */
    let best: ThreadPhoto | null = null;
    let bestGap = 400;
    for (const photo of photos) {
      const gap = Math.abs(photo.atDistanceM - at.d);
      if (gap <= bestGap) { bestGap = gap; best = photo; }
    }
    return best;
  }, [at, photos]);

  const displayedPhoto = heldPhoto ?? photos.find(photo => photo.url === selectedPhoto) ?? photos[0];
  useEffect(() => { if (heldPhoto) setSelectedPhoto(heldPhoto.url); }, [heldPhoto]);
  const enter = () => {
    setExploring(false);
    // Replace this history entry with the held distance before pushing Replay,
    // so browser Back restores exactly the same point as the visible link.
    const from = new URL(replayHref(at?.d), "http://local").searchParams.get("from");
    if (from) navigate(from, { replace: true });
    setDescending(true);
  };
  const afterDescent = () => {
    navigate(replayHref(at ? at.d : undefined));
  };

  const geography = (
    <SeedReliefMap
      routes={withNeighbours}
      selectedSlug={route.slug}
      selectedTrace={route.route}
      focusSelected
      progress={progress}
      onProgress={inspect}
      photos={photos}
      gaps={route.provenance.discontinuities}
      exploring={exploring}
      onTerrainState={setTerrainState}
      pitch={wide ? 54 : 46}
      padding={
        wide
          ? { top: 150, right: 130, bottom: 230, left: leafOpen ? 480 : 130 }
          /*
           * On a phone the page covers the lower half, so the camera has to
           * frame the route into the band that is actually visible. Framing it
           * into the whole viewport put the recorded line behind the page.
           */
          : { top: 96, right: 34, bottom: leafOpen ? Math.round(window.innerHeight * 0.52 + 14) : 190, left: 34 }
      }
      descend={descending ? { progress: progress ?? 0 } : null}
      onDescended={afterDescent}
      threadLabel={title}
    />
  );

  const ribbon = (
    <SeedRibbon
      trace={route.route}
      progress={progress}
      onProgress={inspect}
      photos={photos}
      label={title}
      gaps={route.provenance.discontinuities}
      height={wide ? 96 : 78}
      ink={INK}
      inkSoft={INK_3}
      low={JOURNAL_SURFACES.DATA_BAND}
      high="rgba(195,74,36,0.30)"
      travelled={RELIEF_PALETTE.routeTravelled}
      accent={CORAL}
      rule={JOURNAL_SURFACES.RULE_SOFT}
    />
  );

  /*
   * The entry action. Its label is the reader's own choice of place: hold the
   * thread at 7.2 km and this says so, because entering there is the point.
   */
  const entryLabel = at
    ? `Enter at ${(at.d / 1000).toFixed(1)} km`
    : isMemory(route)
      ? "Fly this route again"
      : "Fly this route";

  const entry = (
    <button
      type="button"
      onClick={enter}
      disabled={descending || terrainState !== "ready"}
      className="seed-control seed-focus flex w-full items-center justify-between"
      style={{
        minHeight: 52, paddingInline: 20, background: FOREST, color: IVORY,
        border: 0, cursor: descending ? "progress" : "pointer",
      }}
    >
      <span style={{ fontFamily: "var(--font-interface)", fontSize: 16.5, letterSpacing: "0.01em" }}>
        {descending ? "Going down…" : terrainState === "ready" ? entryLabel : terrainState === "loading" ? "The landscape is loading…" : "Landscape unavailable"}
      </span>
      <span aria-hidden="true" style={{ fontSize: 15, opacity: 0.85 }}>▾</span>
    </button>
  );

  const smallPrint = [footnote, note.body ? null : "No note saved."]
    .filter(Boolean)
    .join(" · ");

  const leafBody = (
    <>
      <p
        style={{
          fontFamily: "var(--font-interface)", fontSize: 10.5, letterSpacing: "0.2em",
          textTransform: "uppercase", color: INK_3, lineHeight: 1.6,
        }}
      >
        {route.region}
        <span aria-hidden="true" style={{ paddingInline: 8, color: RULE }}>/</span>
        {readableDate(route.date)}
      </p>
      <h1
        style={{
          fontFamily: type.face, fontWeight: 600, fontSize: type.size,
          lineHeight: type.leading, marginTop: 12, marginBottom: 0, color: INK,
          letterSpacing: expressive ? 0 : "0.005em",
        }}
      >
        {title}
      </h1>
      {!isMemory(route) ? (
        <p style={{ marginTop: 12, fontSize: 12.5, color: INK_2 }}>
          An imported route. You have not run this one.
        </p>
      ) : null}

      {note.body ? (
        <div style={{ marginTop: note.body.length > CAPTION_LIMIT ? 22 : 18 }}>
          <Note route={route} size={note.body.length > CAPTION_LIMIT ? 23 : 22} />
        </div>
      ) : null}

      {/* Real photographs are readable immediately; their route positions remain explicit. */}
      {photos.length > 1 ? (
        <div className="seed-photo-index" aria-label="Photographs from this day">
          {photos.map(photo => (
            <button key={photo.url} type="button" className="seed-focus"
              aria-label={`Open photograph: ${photo.title}`} aria-pressed={displayedPhoto?.url === photo.url}
              onClick={() => { setSelectedPhoto(photo.url); inspect(photo.atDistanceM / totalM); }}>
              <img src={photo.url} alt="" />
              <span>{photo.title}<small>{(photo.atDistanceM / 1000).toFixed(1)} km in</small></span>
            </button>
          ))}
        </div>
      ) : null}
      {displayedPhoto ? (
        <figure className="m-0" style={{ marginTop: 22 }}>
          <img
            src={displayedPhoto.url}
            alt={displayedPhoto.title}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
          <figcaption style={{ fontFamily: "var(--font-interface)", fontSize: 11.5, color: INK_2, marginTop: 8 }}>
            {displayedPhoto.title}
            <span style={{ color: INK_3 }}>
              {" "}· taken {(displayedPhoto.atDistanceM / 1000).toFixed(1)} km in
            </span>
          </figcaption>
        </figure>
      ) : null}

      <div style={{ marginTop: 24, borderTop: `1px solid ${RULE}`, paddingTop: 18 }}>
        <Facts route={route} row={!wide} />
      </div>
      {smallPrint ? (
        <p style={{ fontFamily: "var(--font-interface)", fontSize: 11.5, color: INK_3, lineHeight: 1.5, marginTop: 16 }}>
          {smallPrint}
        </p>
      ) : null}
      <div style={{ marginTop: 20 }}>{entry}</div>
    </>
  );

  return (
    <div
      className="seed-theme-journal seed-type-role relative h-dvh w-full overflow-hidden"
      style={{ background: IVORY, color: INK }}
    >
      {/* The landform, floor to ceiling and behind everything. */}
      <div className="absolute inset-0">{geography}</div>

      {/* Quiet return, over the geography. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-4">
        <Link
          to={backPath}
          className={`seed-control seed-focus seed-leaf pointer-events-auto inline-flex items-center px-4 ${descending ? "seed-descending" : ""}`}
          style={{ fontSize: 13.5, gap: 8, color: INK, textDecoration: "none" }}
        >
          <span aria-hidden="true">←</span> {backLabel}
        </Link>
        <div className="flex gap-2">
          <button type="button" onClick={() => setExploring(value => !value)}
            aria-pressed={exploring} aria-label={exploring ? "Finish exploring the landscape" : "Explore the landscape"}
            className={`seed-control seed-focus seed-leaf pointer-events-auto inline-flex items-center gap-2 px-3 ${descending ? "seed-descending" : ""}`}
            style={{ fontSize: 12.5, border: 0 }}>
            <Compass size={16} aria-hidden="true" />{exploring ? "Done" : "Explore"}
          </button>
          <button type="button" onClick={() => setLeafOpen(open => !open)}
            aria-pressed={!leafOpen} aria-label={leafOpen ? "Set the page aside" : "Open the page"}
            className={`seed-control seed-focus seed-leaf pointer-events-auto inline-flex items-center gap-2 px-3 ${descending ? "seed-descending" : ""}`}
            style={{ fontSize: 12.5, border: 0 }}>
            {!wide ? <BookOpen size={16} aria-hidden="true" /> : null}
            {wide ? leafOpen ? "Set the page aside" : "Open the page" : "Page"}
          </button>
        </div>
      </header>

      {!leafOpen && !descending ? (
        <div className="seed-leaf absolute inset-x-5 bottom-6 z-20 mx-auto max-w-sm">{entry}</div>
      ) : null}
      {wide ? (
        <>
          {/* The leaf. Push it aside and the whole place is there. */}
          <aside
            ref={leafRef}
            inert={!leafOpen || descending}
            className={`seed-leaf seed-scroll absolute z-20 ${descending ? "seed-descending" : ""}`}
            style={{
              left: 0, top: 0, bottom: 0, width: 430,
              padding: "78px 40px 34px",
              overflowY: "auto",
              transform: leafOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 420ms var(--ease-interface)",
            }}
            aria-hidden={leafOpen ? undefined : true}
          >
            {leafBody}
          </aside>

          {/* The climb, drawn on the land rather than filed beneath it. */}
          <div
            className={`seed-leaf absolute z-20 ${descending ? "seed-descending" : ""}`}
            style={{
              right: 28, bottom: leafOpen ? 26 : 96, left: leafOpen ? 474 : 28,
              padding: "14px 22px 12px",
              transition: "left 420ms var(--ease-interface)",
            }}
          >
            {ribbon}
          </div>
        </>
      ) : (
        <>
          {/* Narrow: the landform holds the upper screen, the page slides up. */}
          <div
            ref={leafRef as React.RefObject<HTMLDivElement>}
            inert={!leafOpen || descending}
            aria-hidden={!leafOpen || undefined}
            className={`seed-leaf-sheet seed-scroll absolute inset-x-0 z-20 ${descending ? "seed-descending" : ""}`}
            style={{
              bottom: 0,
              top: "52%",
              transform: leafOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 420ms var(--ease-interface)",
              overflowY: "auto",
              padding: "0 20px calc(22px + var(--safe-area-bottom))",
            }}
          >
            <div style={{ paddingTop: 14 }}>{ribbon}</div>
            <div style={{ paddingTop: 20 }}>{leafBody}</div>
          </div>
        </>
      )}
    </div>
  );
}
