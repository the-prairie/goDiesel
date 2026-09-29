import { useCallback, useMemo, useRef } from "react";

import { recordedPointAt, recordedThreadSegments } from "@/domain/geometry/recorded-thread";
import { sampleElevationProfile } from "@/domain/geometry/route-visualization";
import type { ThreadPhoto } from "@/labs/design-seeds/seed-relief-map";
import type { RoutePoint, RouteDiscontinuityEvidence } from "@/domain/route";

/**
 * The climb, as the second grip on the same thread.
 *
 * The map is where the reader takes hold of the land; this is where they take
 * hold of the ascent. Both write one `progress`, so the handle on the ridge and
 * the position on the profile are the same fact shown twice - not two controls
 * that have to be kept in sync.
 *
 * The profile is drawn from a simplified sample because a thousand-point path
 * is wasted at this size, but every number displayed comes from
 * `lookupAtProgress` on the recorded trace, so the readout never disagrees with
 * the geography.
 */

const SAMPLES = 180;

export interface SeedRibbonProps {
  trace: RoutePoint[];
  gaps?: RouteDiscontinuityEvidence[];
  progress?: number;
  onProgress?: (progress: number | undefined) => void;
  photos?: ThreadPhoto[];
  height?: number;
  label: string;
  /** Warm values, passed in so this stays a dumb renderer. */
  ink: string;
  inkSoft: string;
  low: string;
  high: string;
  travelled: string;
  accent: string;
  rule: string;
  className?: string;
}

export function SeedRibbon({
  trace,
  gaps = [],
  progress,
  onProgress,
  photos = [],
  height = 104,
  label,
  ink,
  inkSoft,
  low,
  high,
  travelled,
  accent,
  rule,
  className,
}: SeedRibbonProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const gapsKey = JSON.stringify(gaps);
  const shape = useMemo(() => {
    if (trace.length < 2) return null;
    const total = trace[trace.length - 1].d ?? 0;
    if (!(total > 0)) return null;
    const segments = recordedThreadSegments(trace, JSON.parse(gapsKey));
    const elevations = trace.map(p => p.elev);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const span = max - min || 1;
    const y = (elev: number) => 100 - ((elev - min) / span) * 88 - 6;
    const paths = segments.map(segment => {
      const points = sampleElevationProfile(segment, SAMPLES);
      return {
        line: points.map(p => `${(p.d / total * 100).toFixed(2)},${y(p.elev).toFixed(2)}`).join(" "),
        start: segment[0].d / total * 100,
        end: segment.at(-1)!.d / total * 100,
      };
    });
    return { paths, min, max, total, y };
  }, [trace, gapsKey]);

  const report = useCallback(
    (next: number) => onProgress?.(Math.min(1, Math.max(0, next))),
    [onProgress],
  );

  const fromClientX = useCallback(
    (clientX: number) => {
      const box = hostRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      report((clientX - box.left) / box.width);
    },
    [report],
  );

  if (!shape) return null;
  const at = progress === undefined ? null : recordedPointAt(trace, progress * shape.total, gaps);
  const cut = progress === undefined ? 0 : Math.min(1, Math.max(0, progress));

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 7 }}>
        <span
          style={{
            fontFamily: "var(--font-interface)", fontSize: 10.5,
            letterSpacing: "0.16em", textTransform: "uppercase", color: inkSoft,
          }}
        >
          The climb
        </span>
        {/*
          The live readout. It is the same value the map handle speaks, and it
          holds its place rather than following the playhead, so a number that
          is changing under a moving finger stays where the eye already is.
        */}
        <span
          style={{
            fontFamily: "var(--font-interface)", fontVariantNumeric: "tabular-nums",
            fontSize: 15.5, color: at ? ink : inkSoft, minHeight: 20,
          }}
        >
          {/* The axis already states the altitude range; unheld this shows the
              distance alone rather than repeating it. */}
          {at
            ? `${(at.d / 1000).toFixed(1)} km · ${Math.round(at.elev)} m`
            : "hold the line to inspect"}
        </span>
      </div>

      <div
        ref={hostRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label}: inspect the recorded climb`}
        aria-valuemin={0}
        aria-valuemax={Math.round(shape.total)}
        aria-valuenow={Math.round((progress ?? 0) * shape.total)}
        aria-valuetext={
          at
            ? `${(at.d / 1000).toFixed(1)} kilometres, ${Math.round(at.elev)} metres altitude`
            : "not inspected"
        }
        className="seed-ribbon seed-focus relative w-full"
        style={{ height, borderTop: `1px solid ${rule}`, touchAction: "pan-y" }}
        onPointerDown={(event) => {
          dragging.current = true;
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          fromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          fromClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(event) => {
          const fine = event.shiftKey ? 0.002 : 0.02;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); report((progress ?? 0) + fine); }
          else if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); report((progress ?? 0) - fine); }
          else if (event.key === "Home") { event.preventDefault(); report(0); }
          else if (event.key === "End") { event.preventDefault(); report(1); }
          else if (event.key === "Escape") { onProgress?.(undefined); }
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="seed-ribbon-fill" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={low} />
              <stop offset="100%" stopColor={high} />
            </linearGradient>
            <clipPath id="seed-ribbon-travelled">
              <rect x="0" y="0" width={cut * 100} height="100" />
            </clipPath>
          </defs>
          {shape.paths.map((path, index) => (
            <g key={index}>
              <polygon points={`${path.start},100 ${path.line} ${path.end},100`} fill="url(#seed-ribbon-fill)" />
              <polygon points={`${path.start},100 ${path.line} ${path.end},100`} fill={travelled} opacity="0.34" clipPath="url(#seed-ribbon-travelled)" />
              <polyline points={path.line} fill="none" stroke={ink} strokeWidth="0.9" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {gaps.map((gap, index) => (
            <line key={`gap-${index}`} x1={(gap.startD + gap.endD) / 2 / shape.total * 100} x2={(gap.startD + gap.endD) / 2 / shape.total * 100}
              y1="4" y2="98" stroke={inkSoft} strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke">
              <title>Recording gap</title>
            </line>
          ))}
          {at ? (
            <line
              x1={cut * 100} y1="0" x2={cut * 100} y2="100"
              stroke={accent} strokeWidth="1" strokeOpacity="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Photographs at their recorded distances. Real positions, real media. */}
        {photos.map((photo) => {
          const x = Math.min(1, photo.atDistanceM / shape.total);
          const point = recordedPointAt(trace, x * shape.total, gaps);
          if (!point) return null;
          return (
            <button
              key={photo.url}
              type="button"
              className="seed-ribbon-photo seed-focus absolute"
              style={{ left: `${x * 100}%`, top: `${shape.y(point.elev)}%` }}
              aria-label={`${photo.title}. Taken ${(photo.atDistanceM / 1000).toFixed(1)} kilometres in. Inspect here.`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => report(x)}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}

        {at ? (
          <span aria-hidden="true" className="seed-ribbon-thumb absolute"
            style={{ left: `${cut * 100}%`, top: `${shape.y(at.elev)}%` }}
            onPointerDown={event => {
              event.stopPropagation(); event.preventDefault();
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}>
            <span className="seed-ribbon-playhead" style={{ background: accent }} />
          </span>
        ) : null}
      </div>

      <div
        className="flex items-baseline justify-between"
        style={{
          marginTop: 6, fontFamily: "var(--font-interface)", fontSize: 10.5,
          color: inkSoft, fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>0 km</span>
        <span>
          {Math.round(shape.min)}–{Math.round(shape.max)} m
        </span>
        <span>{(shape.total / 1000).toFixed(1)} km</span>
      </div>
    </div>
  );
}
