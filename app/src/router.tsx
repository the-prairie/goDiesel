import { lazy, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { singleRouteMicrosite } from "@/config/single-route-microsite";
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
const RouteIntelligenceLabPage = lazy(() =>
  import("@/pages/route-intelligence-lab-page").then((module) => ({
    default: module.RouteIntelligenceLabPage,
  })),
);
const GoogleRouteNavigatorLabPage = lazy(() =>
  import("@/pages/google-route-navigator-lab-page").then((module) => ({
    default: module.GoogleRouteNavigatorLabPage,
  })),
);
const CinematicRouteTrailerLabPage = lazy(() =>
  import("@/pages/cinematic-route-trailer-lab-page").then((module) => ({
    default: module.CinematicRouteTrailerLabPage,
  })),
);
const CinematicDirectorLabPage = lazy(() =>
  import("@/pages/cinematic-director-lab-page").then((module) => ({
    default: module.CinematicDirectorLabPage,
  })),
);

canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

function SingleRouteGuard({ children }: { children: ReactNode }) {
  const { routeSlug } = useParams();
  return routeSlug === singleRouteMicrosite?.slug ? (
    children
  ) : (
    <Navigate to={singleRouteMicrosite?.guidePath ?? APP_PATHS.atlas} replace />
  );
}

const productRoutes = [
  { index: true, element: <Navigate to={APP_PATHS.atlas} replace /> },
  { path: APP_PATHS.atlas.slice(1), element: <AtlasPage /> },
  { path: APP_PATHS.finder.slice(1), element: <FinderPage /> },
  { path: APP_PATHS.routes.slice(1), element: <RoutesPage /> },
  { path: "routes/:routeSlug", element: <RouteDetailPage /> },
  { path: APP_PATHS.replay.slice(1), element: <ReplayPage /> },
  { path: "replay/:routeSlug", element: <ReplayPage /> },
  { path: "lab/playable-earth/:routeSlug", element: <PlayableEarthLabPage /> },
  { path: "lab/design-system", element: <DesignSystemFoundationPage /> },
  { path: "lab/route-intelligence", element: <RouteIntelligenceLabPage /> },
  {
    path: "lab/google-route-navigator/:routeSlug",
    element: <GoogleRouteNavigatorLabPage />,
  },
  {
    path: "lab/route-trailer/:routeSlug",
    element: <CinematicRouteTrailerLabPage />,
  },
  {
    path: "lab/cinematic-director/:routeSlug",
    element: <CinematicDirectorLabPage />,
  },
  { path: APP_PATHS.admin.slice(1), element: <AdminPage /> },
  { path: "*", element: <Navigate to={APP_PATHS.atlas} replace /> },
];

const micrositeRoutes = singleRouteMicrosite
  ? [
      {
        index: true,
        element: <Navigate to={singleRouteMicrosite.guidePath} replace />,
      },
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
      {
        path: "*",
        element: <Navigate to={singleRouteMicrosite.guidePath} replace />,
      },
    ]
  : undefined;

const router = createHashRouter([
  {
    element: <AppShell />,
    children: micrositeRoutes ?? productRoutes,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
