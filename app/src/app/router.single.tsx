import { lazy, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";

import { RouteError } from "@/app/route-error";
import { AppShell } from "@/app/app-shell";
import { canonicalizeLegacyQuestHash } from "@/app/route-paths";
import { singleRouteMicrosite } from "@/app/single-route-microsite";

// The route table of a single-route microsite (ADR-0011). vite.config.ts
// aliases `@/app/router` to this module when VITE_SINGLE_ROUTE_SLUG is set, so
// the share bundle only contains the route guide and its replay.
const ReplayPage = lazy(() =>
  import("@/surfaces/replay/replay-page").then((module) => ({ default: module.ReplayPage })),
);
const RouteDetailPage = lazy(() =>
  import("@/surfaces/routes/route-detail-page").then((module) => ({
    default: module.RouteDetailPage,
  })),
);

if (!singleRouteMicrosite) {
  throw new Error("A single-route build requires VITE_SINGLE_ROUTE_SLUG.");
}
const microsite = singleRouteMicrosite;

canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

function SingleRouteGuard({ children }: { children: ReactNode }) {
  const { routeSlug } = useParams();
  return routeSlug === microsite.slug ? children : <Navigate to={microsite.guidePath} replace />;
}

const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={microsite.guidePath} replace /> },
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
      { path: "*", element: <Navigate to={microsite.guidePath} replace /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
