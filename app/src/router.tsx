import { lazy } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { APP_PATHS, canonicalizeLegacyQuestHash } from "@/navigation";

const AdminPage = lazy(() =>
  import("@/pages/admin-page").then((module) => ({ default: module.AdminPage })),
);
const AtlasPage = lazy(() =>
  import("@/pages/atlas-page").then((module) => ({ default: module.AtlasPage })),
);
const FinderPage = lazy(() =>
  import("@/pages/finder-page").then((module) => ({ default: module.FinderPage })),
);
const ReplayPage = lazy(() =>
  import("@/pages/replay-page").then((module) => ({ default: module.ReplayPage })),
);
const PlayableEarthLabPage = lazy(() =>
  import("@/pages/playable-earth-lab-page").then((module) => ({
    default: module.PlayableEarthLabPage,
  })),
);
const RouteDetailPage = lazy(() =>
  import("@/pages/route-detail-page").then((module) => ({
    default: module.RouteDetailPage,
  })),
);
const RoutesPage = lazy(() =>
  import("@/pages/routes-page").then((module) => ({ default: module.RoutesPage })),
);
const DesignSystemFoundationPage = lazy(() =>
  import("@/pages/design-system-foundation-page").then((module) => ({
    default: module.DesignSystemFoundationPage,
  })),
);

canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to={APP_PATHS.atlas} replace /> },
      { path: APP_PATHS.atlas.slice(1), element: <AtlasPage /> },
      { path: APP_PATHS.finder.slice(1), element: <FinderPage /> },
      { path: APP_PATHS.routes.slice(1), element: <RoutesPage /> },
      { path: "routes/:routeSlug", element: <RouteDetailPage /> },
      { path: APP_PATHS.replay.slice(1), element: <ReplayPage /> },
      { path: "replay/:routeSlug", element: <ReplayPage /> },
      { path: "lab/playable-earth/:routeSlug", element: <PlayableEarthLabPage /> },
      { path: "lab/design-system", element: <DesignSystemFoundationPage /> },
      { path: APP_PATHS.admin.slice(1), element: <AdminPage /> },
      { path: "*", element: <Navigate to={APP_PATHS.atlas} replace /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
