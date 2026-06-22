import { ArrowRight, Compass, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { AppSidebar, MobileNav } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { AtlasPage } from "@/pages/atlas-page";
import { completedRoutes, findRouteBySlug, routeHash } from "@/data/routes";
import { hasRouteGeometry, type QuestRoute } from "@/domain/routes";
import { cn } from "@/lib/utils";

export type AppView = "atlas" | "finder" | "routes" | "replay" | "admin";

interface ParsedHash {
  view: AppView;
  routeSlug?: string;
}

function parseInitialHash(): ParsedHash {
  const match = window.location.hash.match(/^#quest\/(.+)$/);
  if (match?.[1]) {
    return {
      view: "replay",
      routeSlug: decodeURIComponent(match[1]),
    };
  }

  return { view: "atlas" };
}

function useInitialRoute() {
  return useMemo(() => parseInitialHash(), []);
}

export function AppShell() {
  const initial = useInitialRoute();
  const [view, setView] = useState<AppView>(initial.view);
  const [selectedRoute, setSelectedRoute] = useState<QuestRoute | undefined>(() =>
    initial.routeSlug ? findRouteBySlug(initial.routeSlug) : completedRoutes[0],
  );

  function navigate(nextView: AppView) {
    setView(nextView);
    if (nextView === "atlas") history.replaceState(null, "", "#");
  }

  function openRoute(route: QuestRoute) {
    setSelectedRoute(route);
    setView("replay");
    history.pushState(null, "", routeHash(route));
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh">
        <AppSidebar activeView={view} onNavigate={navigate} />
        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          <Header />
          <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6">
            {view === "atlas" && <AtlasPage onOpenRoute={openRoute} />}
            {view === "finder" && <FinderHome />}
            {view === "routes" && <RoutesHome onOpenRoute={openRoute} />}
            {view === "replay" && (
              <ReplayHome selectedRoute={selectedRoute} onOpenRoute={openRoute} />
            )}
            {view === "admin" && <AdminHome />}
          </div>
        </main>
      </div>
      <MobileNav activeView={view} onNavigate={navigate} />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3 md:hidden">
          <div className="size-3 rounded-full bg-primary shadow-[0_0_22px_hsl(var(--primary))]" />
          <div>
            <div className="text-base font-bold">godiesel</div>
            <div className="text-xs text-muted-foreground">Quest atlas</div>
          </div>
        </div>
        <div className="hidden text-sm text-muted-foreground md:block">
          Real routes, playable days
        </div>
        <Button variant="secondary" size="sm" asChild>
          <a href="../index.html">
            Static app
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Button>
      </div>
    </header>
  );
}

function SectionTitle({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="mb-3 text-xs font-semibold text-primary">{eyebrow}</div>
      <h1 className="text-3xl font-bold sm:text-5xl">{title}</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">{copy}</p>
    </div>
  );
}

function FinderHome() {
  return (
    <section className="grid gap-6">
      <SectionTitle
        eyebrow="Finder"
        title="Plan the next route without mixing it into memory."
        copy="Finder is intentionally separate from Atlas. U1-U3 model planned and discovered routes now; search and saving behavior lands after completed-route parity."
      />
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-muted-foreground">
        Finder states: discovered, planned, saved-success, no-results, unsupported-query.
      </div>
    </section>
  );
}

function RoutesHome({ onOpenRoute }: { onOpenRoute: (route: QuestRoute) => void }) {
  return (
    <section className="grid gap-6">
      <SectionTitle
        eyebrow="Routes"
        title="All completed quests remain browsable."
        copy="This keeps the current card gallery reachable while the globe becomes the primary entry point."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {completedRoutes.slice(0, 18).map((route) => (
          <button
            key={route.slug}
            type="button"
            onClick={() => onOpenRoute(route)}
            className="rounded-md border border-border bg-card p-4 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="font-semibold">{route.name}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {route.type} · {route.distanceKm.toFixed(1)} km ·{" "}
              {route.elevationGainM.toLocaleString()} m up
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-primary">
              Open replay shell
              <ArrowRight className="size-4" aria-hidden="true" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReplayHome({
  selectedRoute,
  onOpenRoute,
}: {
  selectedRoute?: QuestRoute;
  onOpenRoute: (route: QuestRoute) => void;
}) {
  const pickerRoutes = selectedRoute
    ? [
        selectedRoute,
        ...completedRoutes
          .filter((route) => route.slug !== selectedRoute.slug)
          .slice(0, 11),
      ]
    : completedRoutes.slice(0, 12);

  return (
    <section className="grid gap-6">
      <SectionTitle
        eyebrow="Replay"
        title={selectedRoute ? selectedRoute.name : "Choose a completed route."}
        copy="Replay has a defined first-milestone state here. The Cesium Earth viewer is ported later; for now this confirms direct hash links and route selection do not dead-end."
      />
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-md border border-border bg-card p-5">
          {selectedRoute ? (
            <dl className="grid gap-3 text-sm">
              <Metric label="Distance" value={`${selectedRoute.distanceKm.toFixed(1)} km`} />
              <Metric label="Climb" value={`${selectedRoute.elevationGainM.toLocaleString()} m`} />
              <Metric
                label="Geometry"
                value={hasRouteGeometry(selectedRoute) ? "Ready" : "Missing"}
              />
              <Metric label="Replay mode" value={selectedRoute.replay.replayMode} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a route before entering replay.
            </p>
          )}
        </div>
        <div className="rounded-md border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2 font-semibold">
            <Compass className="size-4 text-primary" aria-hidden="true" />
            Completed route picker
          </div>
          <div className="grid gap-2 pr-2 md:max-h-80 md:overflow-y-auto">
            {pickerRoutes.map((route) => (
              <button
                key={route.slug}
                type="button"
                onClick={() => onOpenRoute(route)}
                className={cn(
                  "rounded-md border border-border px-3 py-3 text-left text-sm outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
                  selectedRoute?.slug === route.slug && "border-primary bg-primary/10",
                )}
              >
                <div className="font-medium">{route.name}</div>
                <div className="text-muted-foreground">
                  {route.distanceKm.toFixed(1)} km · {route.difficulty}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdminHome() {
  return (
    <section className="grid gap-6">
      <SectionTitle
        eyebrow="Admin"
        title="Admin remains explicit during migration."
        copy="The existing local admin surface is not ported in U1-U3. This route exists so navigation has a clear first-milestone behavior."
      />
      <div className="w-fit rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Existing admin runs separately from the React app.
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-primary">{label}</dt>
      <dd className="mt-1 text-base text-foreground">{value}</dd>
    </div>
  );
}
