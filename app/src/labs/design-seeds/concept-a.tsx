import { SeedTerrain } from "@/labs/design-seeds/seed-terrain";
import { SeedProfile } from "@/labs/design-seeds/seed-profile";
import {
  climbLabel, distanceLabel, effortLine, evidenceFootnote, guideAttribution,
  isMemory, movingTime, personalTitle, readableDate, replayActionLabel, shortDate,
} from "@/labs/design-seeds/seed-content";
import type { QuestRoute, RouteSummary } from "@/domain/route";

/* =============================================================================
   A - FIELD ATLAS
   Geography is the page. Chrome is a printed margin over live terrain.
   Structural moves: bottom carousel -> left dated index column;
   place name becomes the largest element, set over its own geography;
   four control clusters collapse to one margin rule.
   ========================================================================== */

const PAPER = "#f4f1e8";
const PAPER_SOFT = "rgba(244,241,232,0.94)";
const INK = "#1a211f";
const INK_2 = "#5a615e";
const INK_3 = "#5f6562"; // was #868b88 - failed AA at 3.07:1 on paper
const LINE = "#cfcabb";
const FOREST = "#0e4039";
const COBALT = "#3379df";
const CORAL = "#d95737";
const CORAL_TEXT = "#9e3a1e"; // coral is a route colour (3:1); as text it must meet 4.5:1

/* ---------------------------------- Atlas --------------------------------- */

export function ConceptAAtlas({
  region, routes, selected, onSelect,
}: {
  region: string;
  routes: RouteSummary[];
  selected: RouteSummary;
  onSelect: (slug: string) => void;
}) {
  const totalKm = routes.reduce((sum, r) => sum + r.distanceKm, 0);
  const totalClimb = routes.reduce((sum, r) => sum + (r.elevationGainM ?? 0), 0);
  const years = Array.from(new Set(routes.map((r) => r.date.slice(0, 4)))).sort();

  return (
    <div className="relative h-dvh w-full overflow-hidden" style={{ background: PAPER }}>
      {/* Live terrain is the page. */}
      <div className="absolute inset-0">
        <SeedTerrain routes={routes} selectedSlug={selected.slug} tone="paper" onSelect={onSelect} padding={{ top: 96, right: 96, bottom: 96, left: 452 }} />
      </div>

      {/* One margin rule across the top. No pills, no segmented controls. */}
      <header
        className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-8"
        style={{ height: 56, background: PAPER_SOFT, borderBottom: `1px solid ${LINE}` }}
      >
        <div className="flex items-baseline gap-6">
          <span style={{ fontFamily: "var(--font-editorial)", fontSize: 17, fontWeight: 600, color: INK, letterSpacing: "0.02em" }}>
            goDiesel
          </span>
          <nav aria-label="Sections" className="flex items-center gap-5">
            {["Atlas", "Routes", "Plan", "Replay"].map((item) => (
              <a
                key={item}
                href="#"
                onClick={(e) => e.preventDefault()}
                className="inline-flex items-center outline-none focus-visible:ring-2"
                style={{
                  minHeight: 44, minWidth: 44, justifyContent: "center", fontSize: 13, letterSpacing: "0.02em",
                  color: item === "Atlas" ? INK : INK_2,
                  borderBottom: item === "Atlas" ? `2px solid ${FOREST}` : "2px solid transparent",
                }}
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
        <div style={{ fontSize: 12, color: INK_3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          30 places · 68 routes
        </div>
      </header>

      {/* The place name is the biggest thing on the screen, over its own geography. */}
      <div className="absolute z-10" style={{ left: 32, top: 96, maxWidth: 620 }}>
        <h1
          style={{
            fontFamily: "var(--font-editorial)", fontWeight: 600, fontSize: 68, lineHeight: 0.98,
            letterSpacing: "0.14em", textTransform: "uppercase", color: INK,
            textShadow: `0 1px 0 ${PAPER}, 0 0 22px ${PAPER}`,
          }}
        >
          {region.split(",")[0]}
        </h1>
        <p style={{ marginTop: 10, display: "inline-block", padding: "4px 10px", background: PAPER_SOFT, borderRadius: 3, fontSize: 13, color: INK_2, letterSpacing: "0.02em" }}>
          {routes.length} routes · {totalKm.toFixed(0)} km · {totalClimb.toLocaleString("en-GB")} m climbed ·{" "}
          {years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0]}
        </p>
      </div>

      {/* Dated edge index: every route keeps its own title. */}
      <aside
        className="absolute z-20 flex flex-col overflow-hidden"
        style={{
          left: 32, top: 236, bottom: 32, width: 388,
          background: PAPER_SOFT, border: `1px solid ${LINE}`, borderRadius: 6,
        }}
        aria-label={`Routes in ${region}`}
      >
        <div className="flex items-baseline justify-between px-4" style={{ height: 44, borderBottom: `1px solid ${LINE}` }}>
          <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: INK_3 }}>
            The index
          </span>
          <span style={{ fontSize: 11, color: INK_3 }}>newest first</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {routes.map((route, index) => {
            const active = route.slug === selected.slug;
            return (
              <li key={route.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(route.slug)}
                  aria-current={active ? "true" : undefined}
                  className="group flex w-full items-start gap-3 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  style={{
                    minHeight: 64, paddingTop: 10, paddingBottom: 10,
                    borderBottom: `1px solid ${LINE}`,
                    background: active ? "rgba(217,87,55,0.07)" : "transparent",
                    boxShadow: active ? `inset 3px 0 0 ${CORAL}` : "none",
                  }}
                >
                  <span
                    style={{
                      minWidth: 26, paddingTop: 2, fontSize: 11, color: active ? CORAL_TEXT : INK_3,
                      fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em",
                    }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Lauren's title, verbatim, clamped not truncated mid-word. */}
                    <span
                      className="block"
                      style={{
                        fontFamily: "var(--font-editorial)", fontSize: 19, lineHeight: 1.18,
                        color: INK, display: "-webkit-box", WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}
                    >
                      {personalTitle(route)}
                    </span>
                    <span className="mt-1 flex items-center gap-2" style={{ fontSize: 11.5, color: INK_2, fontVariantNumeric: "tabular-nums" }}>
                      <span>{shortDate(route.date)} {route.date.slice(0, 4)}</span>
                      <span style={{ color: LINE }}>·</span>
                      <span>{distanceLabel(route.distanceKm)}</span>
                      <span style={{ color: LINE }}>·</span>
                      <span>{climbLabel(route.elevationGainM)} up</span>
                    </span>
                  </span>
                  <span className="mt-1 shrink-0" style={{ width: 68 }}>
                    <SeedProfile
                      points={route.trace}
                      height={26}
                      stroke={active ? CORAL : COBALT}
                      fill={active ? "rgba(217,87,55,0.12)" : "rgba(51,121,223,0.10)"}
                      label={personalTitle(route)}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* One obvious next action for the selected route. */}
      <div
        className="absolute z-20 flex items-center gap-3"
        style={{ right: 32, bottom: 32, background: PAPER_SOFT, border: `1px solid ${LINE}`, borderRadius: 6, padding: 12 }}
      >
        <div style={{ maxWidth: 300 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: INK_3 }}>
            Selected
          </div>
          <div style={{ fontFamily: "var(--font-editorial)", fontSize: 18, lineHeight: 1.2, color: INK, marginTop: 2 }}>
            {personalTitle(selected)}
          </div>
          <div style={{ fontSize: 11.5, color: INK_2, marginTop: 2 }}>
            {effortLine(selected)} · {distanceLabel(selected.distanceKm)}
          </div>
        </div>
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center justify-center outline-none focus-visible:ring-2"
          style={{
            minHeight: 44, padding: "0 18px", background: FOREST, color: PAPER,
            borderRadius: 6, fontSize: 13.5, letterSpacing: "0.02em", whiteSpace: "nowrap",
          }}
        >
          Open this route →
        </a>
      </div>
    </div>
  );
}

/* ------------------------------- Route story ------------------------------- */

export function ConceptAStory({ route }: { route: QuestRoute }) {
  const footnote = evidenceFootnote(route);
  const attribution = guideAttribution(route);
  const time = movingTime(route);
  const summaryLike = { ...route, trace: route.route } as unknown as RouteSummary;

  return (
    <div className="min-h-dvh w-full" style={{ background: PAPER, color: INK }}>
      {/* Compact story header. Back is a real place, not "Route collection". */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4"
        style={{ height: 52, background: PAPER_SOFT, borderBottom: `1px solid ${LINE}`, backdropFilter: "blur(8px)" }}
      >
        <a
          href="#" onClick={(e) => e.preventDefault()}
          className="inline-flex items-center outline-none focus-visible:ring-2"
          style={{ minHeight: 48, minWidth: 48, fontSize: 13.5, color: INK, gap: 6 }}
        >
          ← {route.region.split(",")[0]}
        </a>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: INK_3 }}>
          {readableDate(route.date)}
        </span>
      </header>

      {/* First screen: the place, then the title. Terrain is real, and text sits
          in a reserved column so the trace can never cross it. */}
      <section className="relative" style={{ height: 420 }}>
        <div className="absolute inset-0">
          <SeedTerrain routes={[summaryLike]} selectedSlug={route.slug} tone="paper" focusSelected padding={{ top: 62, right: 28, bottom: 28, left: 28 }} attributionPosition="top-right" />
        </div>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ background: `linear-gradient(to top, ${PAPER} 22%, rgba(244,241,232,0.90) 58%, rgba(244,241,232,0) 100%)`, height: 176 }}
        />
        <div className="absolute inset-x-0 bottom-0 px-5" style={{ paddingBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: INK_2 }}>
            {route.region}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-editorial)", fontWeight: 600, fontSize: 40, lineHeight: 1.04,
              marginTop: 6, color: INK, letterSpacing: "0.01em",
            }}
          >
            {personalTitle(route)}
          </h1>
          {!isMemory(route) ? (
            <p style={{ marginTop: 8, fontSize: 12.5, color: INK_2 }}>
              An imported route. You have not run this one.
            </p>
          ) : null}
        </div>
      </section>

      {/* Facts, plainly. Story-structure counts are not facts, so they are gone. */}
      <section className="px-5" style={{ paddingTop: 20 }}>
        <dl className="grid grid-cols-3" style={{ borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
          {[
            ["Distance", distanceLabel(route.distanceKm)],
            ["Climb", climbLabel(route.elevationGainM)],
            [time ? "Time" : "Effort", time ?? effortLine(route)],
          ].map(([term, value]) => (
            <div key={term} style={{ padding: "12px 0" }}>
              <dt style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: INK_3 }}>{term}</dt>
              <dd style={{ fontSize: 19, marginTop: 3, color: INK, fontVariantNumeric: "tabular-nums" }}>{value}</dd>
            </div>
          ))}
        </dl>

        {/* Your own words, when they exist. Nothing invented when they do not. */}
        {route.curation?.vibe ? (
          <div style={{ paddingTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: INK_3 }}>
              {attribution}
            </div>
            <p style={{ fontFamily: "var(--font-editorial)", fontSize: 21, lineHeight: 1.42, marginTop: 6, color: INK }}>
              {route.curation.vibe}
            </p>
          </div>
        ) : route.description.trim() ? (
          <div style={{ paddingTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: INK_3 }}>
              What you wrote that day
            </div>
            <p style={{ fontFamily: "var(--font-editorial)", fontSize: 21, lineHeight: 1.42, marginTop: 6, color: INK }}>
              {route.description}
            </p>
          </div>
        ) : null}

        {/* The shared distance axis: profile, and the same axis drives replay. */}
        <div style={{ paddingTop: 22 }}>
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: INK_3 }}>
              The climb
            </span>
            <span style={{ fontSize: 11, color: INK_3, fontVariantNumeric: "tabular-nums" }}>
              0 – {distanceLabel(route.distanceKm)}
            </span>
          </div>
          <SeedProfile
            points={route.route}
            height={92}
            stroke={COBALT}
            className="mt-2"
            label={personalTitle(route)}
          />
        </div>

        {/* Evidence lives here, quietly, and only when there is something to say. */}
        {footnote ? (
          <p style={{ marginTop: 14, fontSize: 11.5, color: INK_3, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
            {footnote}
          </p>
        ) : null}
      </section>

      {/* One owner for the transition into Replay. */}
      <div aria-hidden="true" style={{ height: 92 }} />
      <div
        className="fixed inset-x-0 z-30 px-5"
        style={{ bottom: 0, paddingTop: 14, paddingBottom: "calc(16px + var(--safe-area-bottom))", background: PAPER_SOFT, borderTop: `1px solid ${LINE}` }}
      >
        <a
          href="#" onClick={(e) => e.preventDefault()}
          className="flex items-center justify-center outline-none focus-visible:ring-2"
          style={{ minHeight: 48, background: FOREST, color: PAPER, borderRadius: 6, fontSize: 14.5, letterSpacing: "0.02em" }}
        >
          ▶ {replayActionLabel(route)}
        </a>
      </div>
    </div>
  );
}
