import { useCallback, useId, useMemo, useRef, useState } from "react";

import { sampleElevationProfile, elevationRange } from "@/domain/geometry/route-visualization";
import { lookupAtProgress, recordedDistanceM } from "@/labs/design-seeds/seed-geometry";
import type { RoutePoint } from "@/domain/route";

/**
 * The selected route's climb, as part of the route rather than a generic chart.
 *
 * It shares one distance axis with the plate: `onInspect(progress)` reports a
 * fraction of RECORDED distance, and the plate marks the same fraction. Pointer,
 * touch and keyboard all drive the same axis, so the coupling is not
 * mouse-only.
 *
 * Semantics kept straight: the shaded band is ALTITUDE above the route's own
 * recorded minimum, and total ASCENT is a separate recorded figure. Conflating
 * the two is the usual way elevation charts start lying, so the axis is
 * labelled with altitude and ascent is stated as its own number.
 */
export function SeedElevation({
  points,
  totalAscentM,
  height = 120,
  ink = "#635e54",
  rule = "#ddd5c4",
  band = "rgba(51,121,223,0.13)",
  line = "#3379df",
  accent = "#c8502f",
  label,
  onInspect,
  showAscent = true,
  className,
}: {
  points: RoutePoint[];
  /** Recorded ascent. Not derived from the drawn band. */
  totalAscentM: number | null;
  height?: number;
  ink?: string;
  rule?: string;
  band?: string;
  line?: string;
  accent?: string;
  label: string;
  onInspect?: (progress: number | undefined) => void;
  /** Suppress when a neighbouring facts row already states recorded ascent. */
  showAscent?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<number>();
  const describedBy = useId();

  const geometry = useMemo(() => {
    const sampled = sampleElevationProfile(points, 260);
    if (sampled.length < 2) return null;
    const range = elevationRange(sampled);
    const span = Math.max(range.maximum - range.minimum, 1);
    const totalD = sampled[sampled.length - 1].d || 1;
    const coords = sampled.map((point) => ({
      x: (point.d / totalD) * 100,
      y: 100 - ((point.elev - range.minimum) / span) * 100,
      elev: point.elev,
      d: point.d,
    }));
    return {
      coords,
      line: coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" "),
      area: `M0,100 L${coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" L")} L100,100 Z`,
      range,
      totalKm: recordedDistanceM(points) / 1000,
    };
  }, [points]);

  const report = useCallback((next: number | undefined) => {
    setProgress(next);
    onInspect?.(next);
  }, [onInspect]);

  const fromClientX = useCallback((clientX: number) => {
    const host = hostRef.current;
    if (!host) return 0;
    const box = host.getBoundingClientRect();
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
  }, []);

  if (!geometry) {
    return (
      <div className={className} style={{ height }}>
        <p style={{ fontSize: 12, color: ink }}>Elevation was not recorded for this route.</p>
      </div>
    );
  }

  // Readout from the shared lookup on the recorded trace, so the value shown
  // here and the point marked on the map cannot contradict each other. The
  // drawn curve stays a 260-point simplification.
  const reading = progress === undefined ? null : lookupAtProgress(points, progress);
  const at = reading
    ? {
        x: Math.min(Math.max(progress! * 100, 0), 100),
        y: geometry.coords.reduce((best, c) =>
            Math.abs(c.x - progress! * 100) < Math.abs(best.x - progress! * 100) ? c : best,
          geometry.coords[0]).y,
        d: reading.d,
        elev: reading.elev,
      }
    : undefined;

  const step = (delta: number) => {
    const current = progress ?? 0;
    report(Math.min(Math.max(current + delta, 0), 1));
  };

  return (
    <div className={className}>
      {/* Axis header: altitude range on the left, recorded ascent on the right.
          Two different measurements, never merged into one number. */}
      <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: ink }}>
          The climb
        </span>
        {showAscent ? (
          <span style={{ fontSize: 11, color: ink, fontVariantNumeric: "tabular-nums" }}>
            {totalAscentM === null
              ? "ascent not recorded"
              : `${totalAscentM.toLocaleString("en-GB")} m ascent`}
          </span>
        ) : null}
      </div>

      <div
        ref={hostRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label}: inspect recorded elevation along the route`}
        aria-describedby={describedBy}
        aria-valuemin={0}
        aria-valuemax={Math.round(geometry.totalKm * 10) / 10}
        aria-valuenow={at ? Math.round((at.d / 1000) * 10) / 10 : 0}
        aria-valuetext={
          at
            ? `${(at.d / 1000).toFixed(1)} kilometres, ${Math.round(at.elev)} metres altitude`
            : "no position inspected"
        }
        className="seed-focus relative cursor-crosshair"
        style={{
          height,
          borderTop: `1px solid ${rule}`,
          // Touch: allow vertical page scrolling, claim horizontal for scrubbing.
          touchAction: "pan-y",
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          report(fromClientX(event.clientX));
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" && event.buttons === 0) {
            report(fromClientX(event.clientX));
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            report(fromClientX(event.clientX));
          }
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") report(undefined);
        }}
        onFocus={() => { if (progress === undefined) report(0); }}
        onBlur={() => report(undefined)}
        onKeyDown={(event) => {
          const fine = event.shiftKey ? 0.002 : 0.02;
          if (event.key === "ArrowRight") { event.preventDefault(); step(fine); }
          else if (event.key === "ArrowLeft") { event.preventDefault(); step(-fine); }
          else if (event.key === "Home") { event.preventDefault(); report(0); }
          else if (event.key === "End") { event.preventDefault(); report(1); }
          else if (event.key === "Escape") { report(undefined); }
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
        >
          <path d={geometry.area} fill={band} />
          <polyline
            points={geometry.line}
            fill="none"
            stroke={line}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {at ? (
            <line
              x1={at.x} y1="0" x2={at.x} y2="100"
              stroke={accent} strokeWidth="1" strokeOpacity="0.7"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Playhead outside the stretched viewBox, so it stays a true circle. */}
        {at ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${at.x}%`,
              top: `${at.y}%`,
              width: 11, height: 11,
              marginLeft: -5.5, marginTop: -5.5,
              borderRadius: "50%",
              background: accent,
              border: "2px solid #f4efe3",
              boxShadow: "0 1px 3px rgb(40 32 22 / 35%)",
              pointerEvents: "none",
            }}
          />
        ) : null}

        {/* Readout follows the position but stays inside the frame. */}
        {at ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute", top: 4,
              left: `${Math.min(Math.max(at.x, 0), 100)}%`,
              transform: `translateX(${at.x > 62 ? "-100%" : "0"})`,
              paddingInline: 7, paddingBlock: 3,
              background: "rgba(244,239,227,0.94)",
              border: `1px solid ${rule}`,
              fontSize: 11, color: "#413b32", whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(at.d / 1000).toFixed(1)} km · {Math.round(at.elev)} m
          </div>
        ) : null}
      </div>

      {/* Distance axis, and the altitude datum stated plainly. */}
      <div
        className="flex items-baseline justify-between"
        style={{ marginTop: 5, fontSize: 11, color: ink, fontVariantNumeric: "tabular-nums" }}
      >
        <span>0 km</span>
        <span id={describedBy}>
          altitude {Math.round(geometry.range.minimum)} to {Math.round(geometry.range.maximum)} m
        </span>
        <span>{geometry.totalKm.toFixed(1)} km</span>
      </div>
    </div>
  );
}
