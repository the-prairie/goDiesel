import { lazy, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";

import { singleRouteMicrosite } from "@/app/single-route-microsite";

const ReplayPage = lazy(() =>
  import("@/surfaces/replay/replay-page").then((module) => ({ default: module.ReplayPage })),
);
const RouteDetailPage = lazy(() =>
  import("@/surfaces/routes/route-detail-page").then((module) => ({
    default: module.RouteDetailPage,
  })),
);

function SingleRouteGuard({ children }: { children: ReactNode }) {
  const { routeSlug } = useParams();
  return routeSlug === singleRouteMicrosite!.slug ? (
    children
  ) : (
    <Navigate to={singleRouteMicrosite!.guidePath} replace />
  );
}

export function buildRoutes() {
  if (!singleRouteMicrosite) {
    throw new Error("A single-route build requires VITE_SINGLE_ROUTE_SLUG.");
  }
  return [
    { index: true, element: <Navigate to={singleRouteMicrosite.guidePath} replace /> },
    {
      path: "routes/:routeSlug",
      element: (
        <SingleRouteGuard>
          <RouteDetailPage />
        </SingleRouteGuard>
      ),
    },
    {
      path: "replay/:routeSlug",
      element: (
        <SingleRouteGuard>
          <ReplayPage />
        </SingleRouteGuard>
      ),
    },
    { path: "*", element: <Navigate to={singleRouteMicrosite.guidePath} replace /> },
  ];
}
