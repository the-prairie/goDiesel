import { useEffect, useRef, useState } from "react";

import type { RouteAnnotation } from "@/domain/route";
import { splayPlacement } from "@/ui/route-gallery/splay";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import { cn } from "@/ui/utils";

const CARD_WIDTH = 168;

/**
 * Only an interpretation needs a badge. `recorded` is the baseline the product
 * promises, so labelling it would dilute the signal (CONTEXT.md section 4).
 */
const EVIDENCE_LABEL: Partial<Record<RouteAnnotation["evidence"], string>> = {
  derived: "Derived",
  measured: "Measured",
  hypothesis: "Editorial",
};

function distanceLabel(atDistanceM: number) {
  return atDistanceM < 1000
    ? `${Math.round(atDistanceM)} m`
    : `${(atDistanceM / 1000).toFixed(1)} km`;
}

/**
 * A fanned stack of photographs from one route, in the order they were met.
 *
 * The white strip below each image is not spacing. It carries the kilometre
 * mark and, when the image is not recorded evidence, says so.
 */
export function PolaroidFan({
  annotations,
  seed,
  onSelect,
  className,
}: {
  annotations: RouteAnnotation[];
  seed: string;
  onSelect?: (annotation: RouteAnnotation) => void;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const withMedia = annotations.filter((annotation) => annotation.media);
  if (withMedia.length === 0) return null;

  // Reduced motion asks for a plain grid: every card visible, nothing rotated,
  // no overlap to reason about. DESIGN.md requires that a preference removes
  // decorative motion without hiding state.
  const flat = reducedMotion || width < 360;

  return (
    <section aria-label="Route photographs" className={className}>
      <p className="text-caption font-semibold uppercase text-ink-muted">
        Photographs
      </p>
      <div
        ref={containerRef}
        data-testid="polaroid-fan"
        data-layout={flat ? "grid" : "fan"}
        className={cn(
          "relative mt-3",
          flat
            ? "grid grid-cols-2 gap-3"
            : "flex h-[21.5rem] items-center justify-center",
        )}
      >
        {withMedia.map((annotation, index) => {
          const placement = splayPlacement(index, withMedia.length, {
            containerWidth: Math.max(width, CARD_WIDTH),
            cardWidth: CARD_WIDTH,
            seed,
            flat,
          });
          const evidence = EVIDENCE_LABEL[annotation.evidence];

          return (
            <button
              key={annotation.id}
              type="button"
              onClick={() => onSelect?.(annotation)}
              data-testid="polaroid-card"
              data-at-distance-m={annotation.atDistanceM}
              data-evidence={annotation.evidence}
              aria-label={`Photograph ${index + 1} of ${withMedia.length}, at ${distanceLabel(annotation.atDistanceM)}`}
              style={
                flat
                  ? undefined
                  : {
                      transform: `translate(${placement.x}px, ${placement.y}px) rotate(${placement.rotationDeg}deg)`,
                      zIndex: placement.zIndex,
                      width: CARD_WIDTH,
                    }
              }
              className={cn(
                "group border border-line bg-surface-raised p-[7px] pb-2 text-left shadow-panel",
                "transition-[transform,box-shadow] duration-[var(--duration-standard)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
                flat ? "w-full" : "absolute hover:-translate-y-1",
              )}
            >
              <span className="block overflow-hidden bg-surface-muted">
                <img
                  src={annotation.media!.thumbUrl}
                  alt={annotation.title ?? annotation.body}
                  width={annotation.media!.width}
                  height={annotation.media!.height}
                  loading="lazy"
                  className="aspect-[3/4] h-auto w-full object-cover"
                />
              </span>
              <span className="mt-2 flex items-baseline justify-between gap-2 text-caption uppercase">
                <span className="font-mono tabular-nums text-route">
                  {distanceLabel(annotation.atDistanceM)}
                </span>
                {evidence ? (
                  <span className="text-ink-muted">{evidence}</span>
                ) : null}
              </span>
              {annotation.title ? (
                <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                  {annotation.title}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
