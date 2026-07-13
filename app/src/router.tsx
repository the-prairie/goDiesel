import { ArrowLeft, ArrowRight, Compass } from "lucide-react";
import {
  createHashRouter,
  Link,
  Navigate,
  RouterProvider,
  useNavigate,
  useParams,
} from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { hasRouteGeometry, type QuestRoute } from "@/domain/routes";
import { cn } from "@/lib/utils";
import { AtlasPage } from "@/pages/atlas-page";

function normalizeLegacyQuestHash() {
  const match = window.location.hash.match(/^#quest\/(.+)$/);
  if (!match?.[1]) return;

  const slug = encodeURIComponent(decodeURIComponent(match[1]));
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#/routes/${slug}`,
  );
}

normalizeLegacyQuestHash();

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/atlas" replace /> },
      { path: "atlas", element: <AtlasRoute /> },
      { path: "finder", element: <FinderPage /> },
      { path: "routes", element: <RoutesPage /> },
      { path: "routes/:routeSlug", element: <RouteDetailPage /> },
      { path: "replay", element: <ReplayPage /> },
      { path: "replay/:routeSlug", element: <ReplayPage /> },
      { path: "admin", element: <AdminPage /> },
      { path: "*", element: <Navigate to="/atlas" replace /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function AtlasRoute() {
  const navigate = useNavigate();

  return (
    <AtlasPage
      onOpenRoute={(route) => navigate(`/routes/${encodeURIComponent(route.slug)}`)}
    />
  );
}

function PageTitle({
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

function FinderPage() {
  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Finder"
        title="Plan the next day."
        copy="Future routes live here until a completed activity turns them into Atlas memories."
      />
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-muted-foreground">
        Route planning arrives after completed-route parity.
      </div>
    </section>
  );
}

function RoutesPage() {
  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Routes"
        title="All completed routes."
        copy="Browse the routes behind the Atlas and open any day in its canonical route view."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {completedRoutes.slice(0, 18).map((route) => (
          <Link
            key={route.slug}
            to={`/routes/${encodeURIComponent(route.slug)}`}
            className="rounded-md border border-border bg-card p-4 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="font-semibold">{route.name}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {route.type} · {route.distanceKm.toFixed(1)} km ·{" "}
              {route.elevationGainM.toLocaleString()} m up
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-primary">
              Open route
              <ArrowRight className="size-4" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RouteDetailPage() {
  const { routeSlug } = useParams();
  const route = routeSlug ? findRouteBySlug(decodeURIComponent(routeSlug)) : undefined;

  if (!route) return <RouteNotFound />;

  return (
    <section className="grid gap-6">
      <Button asChild variant="ghost" className="w-fit">
        <Link to="/routes">
          <ArrowLeft aria-hidden="true" />
          All routes
        </Link>
      </Button>
      <PageTitle eyebrow={route.region} title={route.name} copy={route.description} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <dl className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-4">
          <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <Metric label="Activity" value={route.type} />
          <Metric label="Difficulty" value={route.difficulty} />
        </dl>
        <Button asChild disabled={!hasRouteGeometry(route)}>
          <Link to={`/replay/${encodeURIComponent(route.slug)}`}>
            <Compass aria-hidden="true" />
            Open replay
          </Link>
        </Button>
      </div>
    </section>
  );
}

function RouteNotFound() {
  return (
    <section className="grid max-w-xl gap-5">
      <PageTitle
        eyebrow="Route unavailable"
        title="This route could not be found."
        copy="The route may have moved or the shared link may be incomplete."
      />
      <Button asChild className="w-fit">
        <Link to="/routes">Browse routes</Link>
      </Button>
    </section>
  );
}

function ReplayPage() {
  const { routeSlug } = useParams();
  const selectedRoute = routeSlug
    ? findRouteBySlug(decodeURIComponent(routeSlug))
    : completedRoutes[0];

  if (routeSlug && !selectedRoute) return <RouteNotFound />;

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
      <PageTitle
        eyebrow="Replay"
        title={selectedRoute?.name ?? "Choose a completed route."}
        copy="Replay preserves route selection and direct links while the Earth viewer moves into React."
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
              <Link
                key={route.slug}
                to={`/replay/${encodeURIComponent(route.slug)}`}
                className={cn(
                  "rounded-md border border-border px-3 py-3 text-left text-sm outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
                  selectedRoute?.slug === route.slug && "border-primary bg-primary/10",
                )}
              >
                <div className="font-medium">{route.name}</div>
                <div className="text-muted-foreground">
                  {route.distanceKm.toFixed(1)} km · {route.difficulty}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdminPage() {
  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Admin"
        title="Route curation."
        copy="The existing owner workflow remains local while its data contract moves into the React app."
      />
      <div className="w-fit rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Local Admin remains a separate process for now.
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
