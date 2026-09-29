export interface RouteThreadStyle {
  /** The recorded line. */
  color: string;
  /** Casing that separates the line from the ground beneath it. */
  halo: string;
  /** Current position. */
  marker: string;
}

/**
 * The default replay thread. Unchanged, and still what the Atlas regional
 * fallback, the Cesium engine and the playable-earth lab use.
 */
export const ROUTE_THREAD_STYLE: RouteThreadStyle = {
  color: "#3379df",
  halo: "#f6f2e8",
  marker: "#d95737",
};

/**
 * Journal replay thread.
 *
 * The journal identifies a selected route by terracotta across the Atlas and
 * the route story, and that identity should survive the transition into Replay.
 * Replay is a dark surface, so the hue is kept and the value lifted:
 * #c34a24 measures 2.27-3.15:1 against openfreemap "fiord" terrain, below the
 * 3:1 a line needs, while #e2673c measures 3.27-4.54:1 across the same range.
 * The casing is warmed to match, at 10.2:1 against dark land.
 *
 * This is a named variant, not a change to the shared default: surfaces that
 * were not part of this direction keep their existing cobalt thread.
 */
export const JOURNAL_REPLAY_THREAD_STYLE: RouteThreadStyle = {
  color: "#e2673c",
  halo: "#f2e4d2",
  marker: "#f7dcc7",
};
