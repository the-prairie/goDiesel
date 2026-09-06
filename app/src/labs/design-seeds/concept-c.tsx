import { SeedTerrain } from "@/labs/design-seeds/seed-terrain";
import { SeedProfile } from "@/labs/design-seeds/seed-profile";
import {
  climbLabel, distanceLabel, effortLine, evidenceFootnote, guideAttribution,
  isMemory, movingTime, personalTitle, readableDate, replayActionLabel,
} from "@/labs/design-seeds/seed-content";
import type { QuestRoute, RouteSummary } from "@/domain/route";

/* =============================================================================
   C - PRECISION TERRAIN
   An instrument for reading ground you have covered.
   Structural moves: the card list is removed - routes are selected by their
   labelled traces on the map; all chrome collapses to one left rail plus a
   corner readout; narrative is demoted to a measured cross-section shared
   identically by Atlas, story, and Replay.
   ========================================================================== */

const NIGHT = "#0c1116";
const PANEL = "rgba(12,17,22,0.86)";
const RAIL = "#141b22";
const MIST = "#e8edf2";
const MIST_2 = "#a3b0bc";
const MIST_3 = "#8c9aa7"; // was #6e7d8a - failed AA at 4.48:1 on night
const HAIR = "rgba(232,237,242,0.14)";
const FOREST = "#1c6b5e";
const COBALT = "#5a9bf0";
const CORAL = "#e86a48";

const NUM: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums lining-nums",
  letterSpacing: "0.04em",
};

function Rail({ active }: { active: string }) {
  const items = [
    { id: "atlas", glyph: "◍", label: "Atlas" },
    { id: "routes", glyph: "≡", label: "Routes" },
    { id: "plan", glyph: "⌕", label: "Plan" },
    { id: "replay", glyph: "▶", label: "Replay" },
    { id: "admin", glyph: "⚙", label: "Admin" },
  ];
  return (
    <nav
      aria-label="Sections"
      className="flex flex-col items-center"
      style={{ width: 64, background: RAIL, borderRight: `1px solid ${HAIR}` }}
    >
      <div
        className="flex items-center justify-center"
        style={{ height: 56, width: "100%", borderBottom: `1px solid ${HAIR}`, color: MIST, fontFamily: "var(--font-editorial)", fontSize: 15, fontWeight: 600 }}
      >
        gD
      </div>
      {items.map((item) => {
        const on = item.id === active;
        return (
          <a
            key={item.id}
            href="#"
            onClick={(e) => e.preventDefault()}
            aria-current={on ? "page" : undefined}
            title={item.label}
            className="flex flex-col items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset"
            style={{
              width: "100%", minHeight: 56, gap: 3,
              color: on ? MIST : MIST_3,
              background: on ? "rgba(232,237,242,0.06)" : "transparent",
              boxShadow: on ? `inset 2px 0 0 ${CORAL}` : "none",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>{item.glyph}</span>
            <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** The readout. Tabular, quiet, no panel chrome beyond a hairline. */
function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid" style={{ gridTemplateColumns: "auto auto", columnGap: 18, rowGap: 5 }}>
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: MIST_3, alignSelf: "baseline" }}>
            {term}
          </dt>
          <dd style={{ ...NUM, fontSize: 13, color: MIST, textAlign: "right" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------- Atlas --------------------------------- */

export function ConceptCAtlas({
  region, routes, selected, onSelect,
}: {
  region: string;
  routes: RouteSummary[];
  selected: RouteSummary;
  onSelect: (slug: string) => void;
}) {
  const totalKm = routes.reduce((sum, r) => sum + r.distanceKm, 0);
  const totalClimb = routes.reduce((sum, r) => sum + (r.elevationGainM ?? 0), 0);

  return (
    <div className="flex h-dvh w-full overflow-hidden" style={{ background: NIGHT, color: MIST }}>
      <Rail active="atlas" />

      <div className="relative min-w-0 flex-1">
        {/* Terrain with the traces labelled in place. No cards anywhere. */}
        <div className="absolute inset-0">
          <SeedTerrain
            routes={routes}
            selectedSlug={selected.slug}
            tone="instrument"
            labelTraces
            onSelect={onSelect}
            padding={{ top: 96, right: 312, bottom: 176, left: 72 }}
          />
        </div>

        {/* Top rule: place name used exactly once per screen. */}
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-end justify-between px-6"
          style={{ height: 84, background: `linear-gradient(to bottom, ${NIGHT} 4%, rgba(12,17,22,0.55) 70%, rgba(12,17,22,0))`, paddingBottom: 14 }}
        >
          <div>
            <h1 style={{ fontFamily: "var(--font-editorial)", fontWeight: 500, fontSize: 30, letterSpacing: "0.22em", textTransform: "uppercase", lineHeight: 1 }}>
              {region.split(",")[0]}
            </h1>
            <p style={{ ...NUM, fontSize: 11, color: MIST_2, marginTop: 6 }}>
              {routes.length} recorded routes · {totalKm.toFixed(1)} km · {totalClimb.toLocaleString("en-GB")} m climbed
            </p>
          </div>
          <p style={{ fontSize: 11, color: MIST_3, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Select a line on the terrain
          </p>
        </div>

        {/* Corner readout for the selected line. */}
        <div
          className="absolute z-20"
          style={{ right: 0, top: 84, width: 284, padding: "18px 24px", background: PANEL, borderLeft: `1px solid ${HAIR}`, borderBottom: `1px solid ${HAIR}` }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MIST_3 }}>
            Selected
          </div>
          <h2
            style={{
              fontSize: 16, lineHeight: 1.3, marginTop: 6, color: MIST,
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}
          >
            {personalTitle(selected)}
          </h2>
          <div style={{ height: 1, background: HAIR, margin: "14px 0" }} />
          <Readout
            rows={[
              ["Distance", distanceLabel(selected.distanceKm)],
              ["Climb", climbLabel(selected.elevationGainM)],
              ["Recorded", readableDate(selected.date)],
              ["Profile", effortLine(selected)],
            ]}
          />
          <a
            href="#" onClick={(e) => e.preventDefault()}
            className="mt-4 flex items-center justify-center outline-none focus-visible:ring-2"
            style={{ minHeight: 44, background: FOREST, color: MIST, fontSize: 13, letterSpacing: "0.04em", borderRadius: 3 }}
          >
            OPEN ROUTE
          </a>
        </div>

        {/* The cross-section: one distance axis, shared by Atlas, story and Replay. */}
        <div
          className="absolute inset-x-0 bottom-0 z-20"
          style={{ height: 132, background: PANEL, borderTop: `1px solid ${HAIR}`, padding: "12px 24px 14px" }}
        >
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MIST_3 }}>
              Cross-section · recorded elevation
            </span>
            <span style={{ ...NUM, fontSize: 11, color: MIST_3 }}>
              0 – {distanceLabel(selected.distanceKm)}
            </span>
          </div>
          <SeedProfile
            points={selected.trace}
            height={78}
            stroke={COBALT}
            fill="rgba(90,155,240,0.15)"
            className="mt-2"
            label={personalTitle(selected)}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Route story ------------------------------- */

export function ConceptCStory({ route }: { route: QuestRoute }) {
  const footnote = evidenceFootnote(route);
  const attribution = guideAttribution(route);
  const time = movingTime(route);
  const summaryLike = { ...route, trace: route.route } as unknown as RouteSummary;

  return (
    <div className="min-h-dvh w-full" style={{ background: NIGHT, color: MIST }}>
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4"
        style={{ height: 52, background: PANEL, borderBottom: `1px solid ${HAIR}`, backdropFilter: "blur(8px)" }}
      >
        <a href="#" onClick={(e) => e.preventDefault()}
          className="inline-flex items-center outline-none focus-visible:ring-2"
          style={{ minHeight: 48, minWidth: 48, fontSize: 13, gap: 6, color: MIST }}>
          ← {route.region.split(",")[0]}
        </a>
        <span style={{ ...NUM, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: MIST_3 }}>
          {readableDate(route.date)}
        </span>
      </header>

      {/* Terrain first, at instrument contrast, with a reserved caption band. */}
      <section className="relative" style={{ height: 340 }}>
        <div className="absolute inset-0">
          <SeedTerrain routes={[summaryLike]} selectedSlug={route.slug} tone="instrument" focusSelected padding={{ top: 58, right: 26, bottom: 26, left: 26 }} attributionPosition="top-right" />
        </div>
        <div
          className="absolute inset-x-0 bottom-0 px-5"
          style={{
            paddingTop: 44, paddingBottom: 16,
            background: `linear-gradient(to top, ${NIGHT} 16%, rgba(12,17,22,0.72) 62%, rgba(12,17,22,0))`,
          }}
        >
          <div style={{ fontFamily: "var(--font-editorial)", fontWeight: 500, fontSize: 15, letterSpacing: "0.22em", textTransform: "uppercase", color: MIST_2 }}>
            {route.region.split(",")[0]}
          </div>
          <h1 style={{ fontSize: 25, lineHeight: 1.22, marginTop: 8, color: MIST, fontWeight: 500 }}>
            {personalTitle(route)}
          </h1>
          {!isMemory(route) ? (
            <p style={{ marginTop: 8, fontSize: 12, color: MIST_2 }}>
              Imported geometry · not a recorded run of yours
            </p>
          ) : null}
        </div>
      </section>

      <section className="px-5" style={{ paddingTop: 18 }}>
        <div style={{ borderTop: `1px solid ${HAIR}`, borderBottom: `1px solid ${HAIR}`, padding: "14px 0" }}>
          <Readout
            rows={[
              ["Distance", distanceLabel(route.distanceKm)],
              ["Climb", climbLabel(route.elevationGainM)],
              [time ? "Elapsed" : "Profile", time ?? effortLine(route)],
            ]}
          />
        </div>

        {route.curation?.vibe ? (
          <div style={{ paddingTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MIST_3 }}>
              {attribution}
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 6, color: MIST_2 }}>
              {route.curation.vibe}
            </p>
          </div>
        ) : route.description.trim() ? (
          <div style={{ paddingTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MIST_3 }}>
              Your note
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 6, color: MIST_2 }}>
              {route.description}
            </p>
          </div>
        ) : null}

        {/* The same cross-section object as Atlas and Replay. */}
        <div style={{ paddingTop: 22 }}>
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MIST_3 }}>
              Cross-section
            </span>
            <span style={{ ...NUM, fontSize: 11, color: MIST_3 }}>
              0 – {distanceLabel(route.distanceKm)}
            </span>
          </div>
          <SeedProfile
            points={route.route}
            height={104}
            stroke={COBALT}
            fill="rgba(90,155,240,0.15)"
            className="mt-2"
            label={personalTitle(route)}
          />
        </div>

        {footnote ? (
          <p style={{ marginTop: 16, fontSize: 11, color: MIST_3, borderTop: `1px solid ${HAIR}`, paddingTop: 10, letterSpacing: "0.02em" }}>
            {footnote}
          </p>
        ) : null}
      </section>

      <div aria-hidden="true" style={{ height: 92 }} />
      <div
        className="fixed inset-x-0 z-30 px-5"
        style={{ bottom: 0, paddingTop: 14, paddingBottom: "calc(16px + var(--safe-area-bottom))", background: PANEL, borderTop: `1px solid ${HAIR}` }}
      >
        <a href="#" onClick={(e) => e.preventDefault()}
          className="flex items-center justify-center outline-none focus-visible:ring-2"
          style={{ minHeight: 48, background: FOREST, color: MIST, borderRadius: 3, fontSize: 13.5, letterSpacing: "0.06em" }}>
          ▶ {replayActionLabel(route).toUpperCase()}
        </a>
      </div>
    </div>
  );
}
