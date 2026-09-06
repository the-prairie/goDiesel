import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/sheet";
import type { RouteSummary } from "@/domain/route";
import { replayPath } from "@/app/route-paths";

export function ReplayRoutePicker({
  compact = false,
  currentSlug,
  renderer,
  routes,
  returnPath,
}: {
  compact?: boolean;
  currentSlug: string;
  renderer?: "atlas" | "cesium" | "cinematic";
  routes: RouteSummary[];
  returnPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const featured = routes.filter((route) => route.replay.bestInEarth);
  const results = useMemo(() => {
    if (!normalizedQuery) return routes;
    return routes.filter((route) =>
      [route.name, route.region, route.type, route.activityName]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, routes]);
  const generalResults = normalizedQuery
    ? results
    : results.filter((route) => !route.replay.bestInEarth);
  const closePicker = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={compact ? "w-9 px-0 sm:w-full sm:px-3" : "w-full"}
        >
          <Search aria-hidden="true" />
          <span className={compact ? "sr-only sm:not-sr-only" : undefined}>
            Change route
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-label="Choose a replay route"
        className="w-[min(36rem,calc(100vw-0.75rem))] sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Choose a replay route</SheetTitle>
          <SheetDescription>
            Search all {routes.length} routes ready for Replay.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <label htmlFor="replay-route-search" className="sr-only">
            Search replay routes
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="replay-route-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search place or activity"
              className="pl-9"
              autoFocus
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {normalizedQuery
              ? `${results.length} replay routes match your search.`
              : `${routes.length} replay routes available.`}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {!normalizedQuery && featured.length > 0 ? (
            <RouteGroup
              label="Featured shortlist"
              description="Routes selected for their strongest Earth Replay experience."
              routes={featured}
              currentSlug={currentSlug}
              onSelect={closePicker}
              renderer={renderer}
              returnPath={returnPath}
            />
          ) : null}
          {generalResults.length > 0 ? (
            <RouteGroup
              label={normalizedQuery ? `${results.length} matches` : "More replay-ready routes"}
              routes={generalResults}
              currentSlug={currentSlug}
              onSelect={closePicker}
              renderer={renderer}
              returnPath={returnPath}
            />
          ) : (
            <div className="grid min-h-48 place-items-center text-center">
              <div>
                <div className="font-medium">No replay routes found</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try another place or activity.
                </p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RouteGroup({
  label,
  description,
  routes,
  currentSlug,
  onSelect,
  renderer,
  returnPath,
}: {
  label: string;
  description?: string;
  routes: RouteSummary[];
  currentSlug: string;
  onSelect: () => void;
  renderer?: "atlas" | "cesium" | "cinematic";
  returnPath?: string;
}) {
  return (
    <section aria-label={label} className="mt-5 first:mt-0">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase text-primary">{label}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="grid gap-1">
        {routes.map((route) => {
          const selected = route.slug === currentSlug;
          const routePath = replayPath(route.slug, returnPath);
          const destination = renderer
            ? `${routePath}${routePath.includes("?") ? "&" : "?"}renderer=${renderer}`
            : routePath;
          return (
            <Link
              key={`${label}-${route.slug}`}
              to={destination}
              aria-current={selected ? "page" : undefined}
              onClick={onSelect}
              className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 rounded-sm border border-transparent px-3 py-2 outline-none hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:bg-primary/10"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{route.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {route.region} · {route.type} · {route.distanceKm.toFixed(1)} km
                </span>
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                {route.replay.bestInEarth ? "Best in Earth" : "Replay ready"}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
