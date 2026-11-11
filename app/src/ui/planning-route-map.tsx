import { forwardRef, lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";

// MapLibre is about 290 kB gzipped. Pages that can show a planning map (Finder,
// the Routes library, Courses) must render their own content first, so the map
// canvas and MapLibre load only once the map's box is actually on screen.
const PlanningRouteMapCanvas = lazy(() =>
  import("@/ui/planning-route-map-canvas").then((module) => ({ default: module.FinderRouteMap })),
);

type FinderRouteMapProps = ComponentProps<typeof PlanningRouteMapCanvas>;

export function FinderRouteMap(props: FinderRouteMapProps) {
  const placeholderRef = useRef<HTMLElement>(null);
  // Latches once: a map that has been shown stays mounted when hidden again
  // (Finder's List/Map toggle), so it keeps its camera and loaded tiles.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (shown || !placeholder) return;
    const observer = new ResizeObserver(() => {
      if (placeholder.clientWidth > 0 && placeholder.clientHeight > 0) setShown(true);
    });
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [shown]);

  if (!shown) return <PlanningMapPlaceholder ref={placeholderRef} selectedSlug={props.selectedSlug} />;
  return (
    <Suspense fallback={<PlanningMapPlaceholder selectedSlug={props.selectedSlug} />}>
      <PlanningRouteMapCanvas {...props} />
    </Suspense>
  );
}

/** Same box and loading copy as the canvas's own loading state, so nothing moves when it arrives. */
const PlanningMapPlaceholder = forwardRef<HTMLElement, { selectedSlug?: string }>(
  function PlanningMapPlaceholder({ selectedSlug }, ref) {
    return (
      <section
        ref={ref}
        aria-label="Finder route map"
        data-map-status="loading"
        data-selected-route={selectedSlug}
        className="relative h-full min-h-0 overflow-hidden bg-canvas"
      >
        <div role="status" className="absolute inset-0 grid place-items-center bg-canvas p-6 text-caption text-ink-secondary">
          Opening planning map.
        </div>
      </section>
    );
  },
);
