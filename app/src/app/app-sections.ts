import {
  Compass,
  Globe2,
  Route,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { APP_PATHS, PLAYABLE_EARTH_LAB_PATH } from "@/app/route-paths";

export type AppSectionId = keyof typeof APP_PATHS;

export interface AppSection {
  id: AppSectionId;
  path: (typeof APP_PATHS)[AppSectionId];
  label: string;
  icon: LucideIcon;
  includesChildren?: boolean;
}

export const APP_SECTIONS: AppSection[] = [
  { id: "atlas", path: APP_PATHS.atlas, label: "Atlas", icon: Globe2 },
  { id: "finder", path: APP_PATHS.finder, label: "Finder", icon: Search },
  {
    id: "routes",
    path: APP_PATHS.routes,
    label: "Routes",
    icon: Route,
    includesChildren: true,
  },
  {
    id: "replay",
    path: APP_PATHS.replay,
    label: "Replay",
    icon: Compass,
    includesChildren: true,
  },
  { id: "admin", path: APP_PATHS.admin, label: "Admin", icon: Settings },
];

export function appSectionForPath(pathname: string) {
  if (
    pathname.startsWith(`${PLAYABLE_EARTH_LAB_PATH}/`)
  ) {
    return APP_SECTIONS.find((section) => section.id === "replay") ?? APP_SECTIONS[0];
  }
  return (
    APP_SECTIONS.find(
      (section) =>
        pathname === section.path ||
        (section.includesChildren && pathname.startsWith(`${section.path}/`)),
    ) ?? APP_SECTIONS[0]
  );
}
