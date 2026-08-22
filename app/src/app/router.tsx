import { lazy, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";

import { AppShell } from "@/app/app-shell";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { APP_PATHS, canonicalizeLegacyQuestHash } from "@/app/route-paths";

const AdminPage = lazy(() =>
  import("@/surfaces/admin/admin-page").then((module) => ({ default: module.AdminPage })),
);
const RouteStudioPage = lazy(() =>
  import("@/surfaces/admin/route-studio-page").then((module) => ({ default: module.RouteStudioPage })),
);
const RouteStudioJobPage = lazy(() =>
  import("@/surfaces/admin/route-studio-job-page").then((module) => ({ default: module.RouteStudioJobPage })),
);
const StagedStudioPreviewPage = lazy(() =>
  import("@/surfaces/replay/staged-studio-preview-page").then((module) => ({ default: module.StagedStudioPreviewPage })),
);
const AtlasPage = lazy(() =>
  import("@/surfaces/atlas/atlas-page").then((module) => ({ default: module.AtlasPage })),
);
const FinderPage = lazy(() =>
  import("@/surfaces/finder/finder-page").then((module) => ({ default: module.FinderPage })),
);
const ReplayPage = lazy(() =>
  import("@/surfaces/replay/replay-page").then((module) => ({ default: module.ReplayPage })),
);
const PlayableEarthLabPage = lazy(() =>
  import("@/labs/playable-earth/playable-earth-lab-page").then((module) => ({
    default: module.PlayableEarthLabPage,
  })),
);
const RouteDetailPage = lazy(() =>
  import("@/surfaces/routes/route-detail-page").then((module) => ({
    default: module.RouteDetailPage,
  })),
);
const RoutesPage = lazy(() =>
  import("@/surfaces/routes/routes-page").then((module) => ({ default: module.RoutesPage })),
);
const DesignSystemLabPage = lazy(() =>
  import("@/labs/design-system/design-system-lab-page").then((module) => ({
    default: module.DesignSystemLabPage,
  })),
);
const RouteIntelligenceLabPage = lazy(() =>
  import("@/labs/route-intelligence/route-intelligence-lab-page").then((module) => ({
    default: module.RouteIntelligenceLabPage,
  })),
);
const GoogleRouteNavigatorLabPage = lazy(() =>
  import("@/labs/google-route-navigator/google-route-navigator-lab-page").then((module) => ({
    default: module.GoogleRouteNavigatorLabPage,
  })),
);
const CinematicRouteTrailerLabPage = lazy(() =>
  import("@/labs/cinematic/cinematic-route-trailer-lab-page").then((module) => ({
    default: module.CinematicRouteTrailerLabPage,
  })),
);
const CinematicDirectorLabPage = lazy(() =>
  import("@/labs/cinematic/cinematic-director-lab-page").then((module) => ({
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
  { path: "lab/design-system", element: <DesignSystemLabPage /> },
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
  { path: "admin/studio", element: <RouteStudioPage /> },
  { path: "admin/studio/:jobId", element: <RouteStudioJobPage /> },
  { path: "admin/studio/:jobId/preview", element: <StagedStudioPreviewPage /> },
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
