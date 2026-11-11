import { lazy } from "react";
import {
  createHashRouter,
  Navigate,
  replace,
  RouterProvider,
  type RouteObject,
} from "react-router-dom";

import { RouteError } from "@/app/route-error";
import { AppShell } from "@/app/app-shell";
import {
  APP_PATHS,
  canonicalizeLegacyQuestHash,
  LEGACY_QUEST_ROUTE_PATH,
  routeDetailPath,
} from "@/app/route-paths";

// A single-route microsite build aliases this module to router.single.tsx
// (see vite.config.ts), so no product surface below reaches a share bundle.

const AdminPage = lazy(() =>
  import("@/surfaces/admin/admin-page").then((module) => ({ default: module.AdminPage })),
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
const CoursePage = lazy(() => import("@/surfaces/courses/course-page").then(module => ({ default: module.CoursePage })));
const CoursePreviewPage = lazy(() => import("@/surfaces/replay/course-preview-page").then(module => ({ default: module.CoursePreviewPage })));
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

const productRoutes: RouteObject[] = [
  { index: true, element: <Navigate to={APP_PATHS.atlas} replace /> },
  { path: APP_PATHS.atlas.slice(1), element: <AtlasPage /> },
  { path: APP_PATHS.finder.slice(1), element: <FinderPage /> },
  { path: APP_PATHS.routes.slice(1), element: <RoutesPage /> },
  { path: "courses", element: <CoursePage /> },
  { path: "courses/:courseId", element: <CoursePage /> },
  { path: "courses/:courseId/preview", element: <CoursePreviewPage /> },
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
  {
    path: LEGACY_QUEST_ROUTE_PATH,
    loader: ({ params }) => replace(routeDetailPath(params.legacySlug ?? "")),
  },
  { path: "*", element: <Navigate to={APP_PATHS.atlas} replace /> },
];

export const productRouteTree: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: productRoutes,
  },
];

let router: ReturnType<typeof createHashRouter> | undefined;

function appRouter() {
  if (!router) {
    // A legacy link opened before the app starts is rewritten before the
    // router reads its first location.
    canonicalizeLegacyQuestHash();
    router = createHashRouter(productRouteTree);
  }
  return router;
}

export function AppRouter() {
  return <RouterProvider router={appRouter()} />;
}
