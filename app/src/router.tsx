import { createHashRouter, Navigate, RouterProvider, useNavigate } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { APP_PATHS, canonicalizeLegacyQuestHash, routeDetailPath } from "@/navigation";
import { AdminPage } from "@/pages/admin-page";
import { AtlasPage } from "@/pages/atlas-page";
import { FinderPage } from "@/pages/finder-page";
import { ReplayPage } from "@/pages/replay-page";
import { RouteDetailPage } from "@/pages/route-detail-page";
import { RoutesPage } from "@/pages/routes-page";

canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to={APP_PATHS.atlas} replace /> },
      { path: APP_PATHS.atlas.slice(1), element: <AtlasRoute /> },
      { path: APP_PATHS.finder.slice(1), element: <FinderPage /> },
      { path: APP_PATHS.routes.slice(1), element: <RoutesPage /> },
      { path: "routes/:routeSlug", element: <RouteDetailPage /> },
      { path: APP_PATHS.replay.slice(1), element: <ReplayPage /> },
      { path: "replay/:routeSlug", element: <ReplayPage /> },
      { path: APP_PATHS.admin.slice(1), element: <AdminPage /> },
      { path: "*", element: <Navigate to={APP_PATHS.atlas} replace /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function AtlasRoute() {
  const navigate = useNavigate();

  return (
    <AtlasPage onOpenRoute={(route) => navigate(routeDetailPath(route.slug))} />
  );
}
