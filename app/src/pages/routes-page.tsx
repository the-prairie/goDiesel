import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { PageTitle } from "@/components/page-title";
import { completedRoutes } from "@/data/routes";
import { routeDetailPath } from "@/navigation";

export function RoutesPage() {
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
            to={routeDetailPath(route.slug)}
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
