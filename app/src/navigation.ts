import {
  Compass,
  Globe2,
  Route,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

export const APP_PATHS = {
  atlas: "/atlas",
  finder: "/finder",
  routes: "/routes",
  replay: "/replay",
  admin: "/admin",
} as const;

export const PLAYABLE_EARTH_LAB_PATH = "/lab/playable-earth";

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
  if (pathname.startsWith(`${PLAYABLE_EARTH_LAB_PATH}/`)) {
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

function encodedSlug(slug: string) {
  return encodeURIComponent(slug);
}

export function routeDetailPath(slug: string) {
  return `${APP_PATHS.routes}/${encodedSlug(slug)}`;
}

export function replayPath(slug: string) {
  return `${APP_PATHS.replay}/${encodedSlug(slug)}`;
}

export function playableEarthLabPath(slug: string) {
  return `${PLAYABLE_EARTH_LAB_PATH}/${encodedSlug(slug)}`;
}

export function decodedRouteSlug(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function canonicalizeLegacyQuestHash() {
  const match = window.location.hash.match(/^#quest\/(.+)$/);
  if (!match?.[1]) return false;

  const path = routeDetailPath(decodedRouteSlug(match[1]) ?? match[1]);
  window.location.replace(
    `${window.location.pathname}${window.location.search}#${path}`,
  );
  return true;
}
