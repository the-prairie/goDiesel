import { lazy, Suspense, type ReactNode } from "react";
import {
  createHashRouter,
  Navigate,
  replace,
  RouterProvider,
  type RouteObject,
  useParams,
} from "react-router-dom";

import { RootRouteError, RouteError } from "@/app/route-error";
import { AppShell } from "@/app/app-shell";
import { LEGACY_QUEST_ROUTE_PATH } from "@/app/route-paths";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { SurfacePlaceholder } from "@/app/surface-placeholder";

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

function SingleRouteGuard({ children }: { children: ReactNode }) {
  const { routeSlug } = useParams();
  return routeSlug === microsite.slug ? children : <Navigate to={microsite.guidePath} replace />;
}

export const singleRouteTree: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RootRouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to={microsite.guidePath} replace /> },
          {
            path: "routes/:routeSlug",
            handle: { surface: "route" },
            element: (
              <SingleRouteGuard>
                <Suspense fallback={<SurfacePlaceholder surface="route" />}>
                  <RouteDetailPage />
                </Suspense>
              </SingleRouteGuard>
            ),
          },
          {
            path: "replay/:routeSlug",
            handle: { surface: "replay" },
            element: (
              <SingleRouteGuard>
                <Suspense fallback={<SurfacePlaceholder surface="replay" />}>
                  <ReplayPage />
                </Suspense>
              </SingleRouteGuard>
            ),
          },
          // A legacy link only ever opens this share's guide. It is not rewritten
          // to the slug it names first, so another route's identifier never
          // becomes a microsite URL, before or after the app has started.
          { path: LEGACY_QUEST_ROUTE_PATH, loader: () => replace(microsite.guidePath) },
          // So does any other path: a share never names or opens another surface.
          { path: "*", loader: () => replace(microsite.guidePath) },
        ],
      },
    ],
  },
];

let router: ReturnType<typeof createHashRouter> | undefined;

function appRouter() {
  router ??= createHashRouter(singleRouteTree);
  return router;
}

export function AppRouter() {
  return <RouterProvider router={appRouter()} />;
}
