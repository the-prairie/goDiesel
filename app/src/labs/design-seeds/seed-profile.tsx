import { useMemo, type CSSProperties } from "react";

import { sampleElevationProfile, elevationRange } from "@/domain/geometry/route-visualization";
import type { RoutePoint } from "@/domain/route";

/**
 * Recorded elevation, drawn from the real track.
 *
 * The signature interaction across all three seeds is that this profile shares
 * one distance axis with the map trace and the replay playhead, so a position
 * means the same thing everywhere it appears. `progress` is 0..1 along distance.
 */
export function SeedProfile({
  points,
  progress,
  stroke = "#3379df",
  fill = "rgba(51,121,223,0.14)",
  playhead = "#d95737",
  height = 64,
  showPlayhead = false,
  className,
  label,
}: {
  points: RoutePoint[];
  progress?: number;
  stroke?: string;
  fill?: string;
  playhead?: string;
  height?: number;
  showPlayhead?: boolean;
  className?: string;
  label: string;
}) {
  const geometry = useMemo(() => {
    const sampled = sampleElevationProfile(points, 240);
    if (sampled.length < 2) return null;
    const range = elevationRange(sampled);
    const span = Math.max(range.maximum - range.minimum, 1);
    const totalD = sampled[sampled.length - 1].d || 1;
    const coords = sampled.map((point) => {
      const x = (point.d / totalD) * 100;
      const y = 100 - ((point.elev - range.minimum) / span) * 100;
      return { x, y };
    });
    return {
      line: coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" "),
      area: `M0,100 L${coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" L")} L100,100 Z`,
      range,
      coords,
    };
  }, [points]);

  if (!geometry) {
    return (
      <div
        role="img"
        aria-label={`${label}: elevation not recorded`}
        className={className}
        style={{ height }}
      />
    );
  }

  const clamped = Math.min(Math.max(progress ?? 0, 0), 1);
  const headX = clamped * 100;
  const nearest = geometry.coords.reduce((best, c) =>
    Math.abs(c.x - headX) < Math.abs(best.x - headX) ? c : best, geometry.coords[0]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: recorded elevation from ${Math.round(geometry.range.minimum)} to ${Math.round(geometry.range.maximum)} metres`}
      className={className}
      style={{ height, display: "block", width: "100%" }}
    >
      <path d={geometry.area} fill={fill} />
      <polyline
        points={geometry.line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showPlayhead ? (
        <>
          <line
            x1={headX} y1="0" x2={headX} y2="100"
            stroke={playhead} strokeWidth="1" strokeOpacity="0.55"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={headX} cy={nearest.y} r="2.4" fill={playhead} stroke="#fffaf2" strokeWidth="1"
            vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
    </svg>
  );
}

/** The route drawn as a shape, from real geometry. Used at small sizes as an index mark. */
export function SeedTraceMark({
  points,
  stroke,
  strokeWidth = 1.4,
  className,
  style,
  label,
}: {
  points: RoutePoint[];
  stroke: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  label: string;
}) {
  const line = useMemo(() => {
    if (points.length < 2) return null;
    let minLat = points[0].lat, maxLat = points[0].lat;
    let minLng = points[0].lng, maxLng = points[0].lng;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const latSpan = Math.max(maxLat - minLat, 1e-6);
    const lngSpan = Math.max(maxLng - minLng, 1e-6);
    // Keep aspect honest: scale both axes by the larger span.
    const span = Math.max(latSpan, lngSpan);
    const offsetX = (span - lngSpan) / 2;
    const offsetY = (span - latSpan) / 2;
    // 200 points per glyph x 8 rows measurably delayed the Atlas plate's route
    // overlay on cold load. 90 is indistinguishable at 48px and halves the work.
    const step = Math.max(1, Math.floor(points.length / 90));
    const coords: string[] = [];
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      const x = ((p.lng - minLng + offsetX) / span) * 100;
      const y = 100 - ((p.lat - minLat + offsetY) / span) * 100;
      coords.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return coords.join(" ");
  }, [points]);

  if (!line) return <div className={className} style={style} role="img" aria-label={`${label}: no recorded geometry`} />;

  return (
    <svg
      viewBox="-6 -6 112 112"
      role="img"
      aria-label={`${label}: recorded route shape`}
      className={className}
      style={style}
    >
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
