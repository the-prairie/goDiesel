import { lazy, Suspense, type ComponentType } from "react";
import {
  createHashRouter,
  Navigate,
  replace,
  RouterProvider,
  type RouteObject,
} from "react-router-dom";

import { RootRouteError, RouteError } from "@/app/route-error";
import { AppShell } from "@/app/app-shell";
import { NotFoundPage } from "@/app/not-found-page";
import { SurfacePlaceholder, type Surface } from "@/app/surface-placeholder";
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
const OverlandLabPage = lazy(() =>
  import("@/labs/overland/overland-lab-page").then((module) => ({
    default: module.OverlandLabPage,
  })),
);
const CinematicDirectorLabPage = lazy(() =>
  import("@/labs/cinematic/cinematic-director-lab-page").then((module) => ({
    default: module.CinematicDirectorLabPage,
  })),
);

/** A lazy view, with a placeholder that reserves its surface's layout. */
function view(path: string, surface: Surface, Page: ComponentType): RouteObject {
  return {
    path,
    handle: { surface },
    element: (
      <Suspense fallback={<SurfacePlaceholder surface={surface} />}>
        <Page />
      </Suspense>
    ),
  };
}

const productRoutes: RouteObject[] = [
  { index: true, element: <Navigate to={APP_PATHS.atlas} replace /> },
  view(APP_PATHS.atlas.slice(1), "atlas", AtlasPage),
  view(APP_PATHS.finder.slice(1), "finder", FinderPage),
  view(APP_PATHS.routes.slice(1), "routes", RoutesPage),
  view("courses", "courses", CoursePage),
  view("courses/:courseId", "courses", CoursePage),
  view("courses/:courseId/preview", "course-preview", CoursePreviewPage),
  view("routes/:routeSlug", "route", RouteDetailPage),
  view(APP_PATHS.replay.slice(1), "replay", ReplayPage),
  view("replay/:routeSlug", "replay", ReplayPage),
  view("lab/playable-earth/:routeSlug", "lab", PlayableEarthLabPage),
  view("lab/design-system", "lab", DesignSystemLabPage),
  view("lab/route-intelligence", "lab", RouteIntelligenceLabPage),
  view("lab/google-route-navigator/:routeSlug", "lab", GoogleRouteNavigatorLabPage),
  view("lab/route-trailer/:routeSlug", "lab", CinematicRouteTrailerLabPage),
  view("lab/cinematic-director/:routeSlug", "lab", CinematicDirectorLabPage),
  view("lab/overland", "lab", OverlandLabPage),
  view("lab/overland/:routeSlug", "lab", OverlandLabPage),
  view(APP_PATHS.admin.slice(1), "admin", AdminPage),
  {
    path: LEGACY_QUEST_ROUTE_PATH,
    loader: ({ params }) => replace(routeDetailPath(params.legacySlug ?? "")),
  },
  // A mistyped or stale link says so, inside the shell; it never silently
  // becomes Atlas.
  { path: "*", handle: { surface: "missing" }, element: <NotFoundPage /> },
];

export const productRouteTree: RouteObject[] = [
  {
    element: <AppShell />,
    // Last resort, for a failure in the shell itself.
    errorElement: <RootRouteError />,
    children: [
      {
        // A view that fails to open is caught here, inside the shell, so the
        // primary navigation stays usable.
        errorElement: <RouteError />,
        children: productRoutes,
      },
    ],
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
