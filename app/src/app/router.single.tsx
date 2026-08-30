import { lazy, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";

import { AppShell } from "@/app/app-shell";
import { canonicalizeLegacyQuestHash } from "@/app/route-paths";
import { singleRouteMicrosite } from "@/app/single-route-microsite";

const ReplayPage = lazy(() =>
  import("@/surfaces/replay/replay-page").then((module) => ({ default: module.ReplayPage })),
);
const RouteDetailPage = lazy(() =>
  import("@/surfaces/routes/route-detail-page").then((module) => ({
    default: module.RouteDetailPage,
  })),
);

canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

function SingleRouteGuard({ children }: { children: ReactNode }) {
  const { routeSlug } = useParams();
  return routeSlug === singleRouteMicrosite!.slug ? (
    children
  ) : (
    <Navigate to={singleRouteMicrosite!.guidePath} replace />
  );
}

if (!singleRouteMicrosite) {
  throw new Error("A single-route build requires VITE_SINGLE_ROUTE_SLUG.");
}

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
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
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
