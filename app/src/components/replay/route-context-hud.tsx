import { ArrowLeft, ChevronDown, ChevronUp, Map, Route } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { QuestRoute } from "@/domain/routes";
import { cn } from "@/lib/utils";
import { routeDetailPath } from "@/navigation";

export type RouteContextHudState = "preview" | "compact" | "expanded";

export function RouteContextHud({
  route,
  label,
  testId,
  detailsTestId,
  state,
  backPath,
  backLabel,
  visible = true,
  icon,
  summary,
  actions,
  className,
  onStateChange,
}: {
  route: QuestRoute;
  label: string;
  testId: string;
  detailsTestId: string;
  state: RouteContextHudState;
  backPath: string;
  backLabel: string;
  visible?: boolean;
  icon?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
  onStateChange: (state: RouteContextHudState) => void;
}) {
  const detailsVisible = state !== "compact";

  return (
    <div
      data-testid={testId}
      data-ui="route-context-hud"
      data-context-state={state}
      data-mobile-expanded={detailsVisible}
      className={cn(
        "pointer-events-auto w-full max-w-sm border border-line border-l-2 border-l-route bg-surface/94 p-3 text-ink shadow-panel backdrop-blur sm:p-4",
        "transition-[opacity,transform] duration-[var(--duration-slow)]",
        !visible && "pointer-events-none -translate-y-2 opacity-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-caption font-semibold uppercase text-route">
          {icon ?? <Route className="size-4 shrink-0" aria-hidden="true" />}
          <span className="truncate">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="size-9">
            <Link to={backPath} aria-label={backLabel} title={backLabel}>
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-9">
            <Link
              to={routeDetailPath(route.slug)}
              aria-label="Route guide"
              title="Route guide"
            >
              <Map aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={detailsVisible ? "Hide route details" : "Show route details"}
            aria-expanded={detailsVisible}
            onClick={() =>
              onStateChange(detailsVisible ? "compact" : "expanded")
            }
          >
            {detailsVisible ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      <h1 className="mt-1 truncate font-editorial text-2xl font-semibold sm:text-3xl">
        {route.name}
      </h1>
      <div
        data-testid={detailsTestId}
        className={cn(!detailsVisible && "hidden")}
      >
        <p className="mt-1 text-control text-ink-secondary">
          {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up
        </p>
        {summary}
        {actions ? (
          <div className="mt-3 border-t border-line pt-3">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
