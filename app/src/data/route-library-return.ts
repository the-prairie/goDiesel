const storageKey = "godiesel:route-library-return";

interface RouteLibraryReturnRecord {
  path: string;
  routeSlug: string;
  scrollY: number;
}

export function rememberRouteLibraryReturn(
  path: string,
  routeSlug: string,
  scrollY: number,
) {
  if (!path.startsWith("/routes")) return;
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({ path, routeSlug, scrollY } satisfies RouteLibraryReturnRecord),
  );
}

export function routeLibraryReturnPath(routeSlug: string) {
  const record = readReturnRecord();
  return record?.routeSlug === routeSlug ? record.path : undefined;
}

export function takeRouteLibraryScroll(path: string) {
  const record = readReturnRecord();
  if (!record || record.path !== path) return undefined;
  sessionStorage.removeItem(storageKey);
  return record.scrollY;
}

function readReturnRecord(): RouteLibraryReturnRecord | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as unknown;
    if (!value || typeof value !== "object") return undefined;
    const record = value as Partial<RouteLibraryReturnRecord>;
    if (
      typeof record.path !== "string" ||
      !record.path.startsWith("/routes") ||
      typeof record.routeSlug !== "string" ||
      typeof record.scrollY !== "number" ||
      !Number.isFinite(record.scrollY)
    ) {
      return undefined;
    }
    return record as RouteLibraryReturnRecord;
  } catch {
    return undefined;
  }
}
