import { createHashRouter, RouterProvider } from "react-router-dom";

import { AppShell } from "@/app/app-shell";
import { buildRoutes } from "@/app/build-routes";
import { canonicalizeLegacyQuestHash } from "@/app/route-paths";
canonicalizeLegacyQuestHash();
window.addEventListener("hashchange", canonicalizeLegacyQuestHash);

const router = createHashRouter([
  {
    element: <AppShell />,
    children: buildRoutes(),
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
