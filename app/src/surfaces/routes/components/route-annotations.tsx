import type { RouteAnnotation } from "@/domain/route";
import { cn } from "@/ui/utils";

const KIND_LABEL: Record<RouteAnnotation["kind"], string> = {
  note: "Note",
  landmark: "Landmark",
  warning: "Take care",
  image: "Photo",
};

/**
 * How much the product knows about this annotation. CONTEXT.md section 4
 * requires that an interpretation is never presented as recorded truth, so a
 * `hypothesis` says so on its face. A `recorded` value needs no badge, because
 * recorded is the baseline the product promises.
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
 * Annotations in the order they are met along the route. The generator sorts by
 * anchor and the strict parser verifies that order, so this renders the list as
 * given rather than sorting again.
 */
export function RouteAnnotations({
  annotations,
  className,
}: {
  annotations: RouteAnnotation[];
  className?: string;
}) {
  if (annotations.length === 0) return null;

  return (
    <section
      aria-label="Route annotations"
      data-testid="route-annotations"
      className={className}
    >
      <p className="text-caption font-semibold uppercase text-ink-muted">
        Along the route
      </p>
      <ol className="mt-2 border-l border-line">
        {annotations.map((annotation) => {
          const evidence = EVIDENCE_LABEL[annotation.evidence];
          return (
            <li
              key={annotation.id}
              data-testid="route-annotation"
              data-kind={annotation.kind}
              data-evidence={annotation.evidence}
              data-at-distance-m={annotation.atDistanceM}
              className="relative py-3 pl-4 first:pt-2 last:pb-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-[3px] top-[1.15rem] size-[5px] rounded-full",
                  annotation.kind === "warning" ? "bg-coral" : "bg-route",
                )}
              />
              <p className="flex flex-wrap items-baseline gap-x-2 text-caption uppercase text-ink-muted">
                <span className="font-mono tabular-nums text-route">
                  {distanceLabel(annotation.atDistanceM)}
                </span>
                <span>{KIND_LABEL[annotation.kind]}</span>
                {evidence ? (
                  <span className="border border-line px-1 not-italic text-ink-muted">
                    {evidence}
                  </span>
                ) : null}
              </p>
              {annotation.title ? (
                <p className="mt-1 text-control font-semibold text-ink">
                  {annotation.title}
                </p>
              ) : null}
              <p className="mt-1 text-control text-ink-secondary">{annotation.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
