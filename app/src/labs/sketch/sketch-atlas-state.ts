// Where she is in the sketch atlas: the world, one country, one place (and,
// in a place, the route she has chosen). The breadcrumb names each level she
// passed through; going up drops what was below.

export type AtlasState =
  | { phase: "world" }
  | { phase: "country"; country: string }
  | { phase: "place"; country: string; place: string; route: string | null };

export type AtlasEvent =
  | { type: "countryChosen"; country: string }
  | { type: "placeChosen"; country: string; place: string }
  | { type: "routeChosen"; slug: string }
  | { type: "up"; to: "world" | "country" | "place" };

export function initialAtlasState(): AtlasState {
  return { phase: "world" };
}

/** Opening on a named route: its place, with it chosen. */
export function atlasFromRoute({ slug, country, place }: { slug: string; country: string; place: string }): AtlasState {
  return { phase: "place", country, place, route: slug };
}

export function reduceAtlas(state: AtlasState, event: AtlasEvent): AtlasState {
  switch (event.type) {
    case "countryChosen":
      return { phase: "country", country: event.country };
    case "placeChosen":
      return { phase: "place", country: event.country, place: event.place, route: null };
    case "routeChosen":
      return state.phase === "place" ? { ...state, route: event.slug } : state;
    case "up":
      if (event.to === "world") return { phase: "world" };
      if (event.to === "country") return state.phase === "world" ? state : { phase: "country", country: state.country };
      return state.phase === "place" ? { ...state, route: null } : state;
  }
}

export interface Crumb {
  level: "world" | "country" | "place" | "street";
  label: string;
  current: boolean;
}

/** The breadcrumb: every level down to where she is, the last one current. */
export function crumbsOf(state: AtlasState): Crumb[] {
  const crumbs: Omit<Crumb, "current">[] = [{ level: "world", label: "World" }];
  if (state.phase !== "world") crumbs.push({ level: "country", label: state.country });
  if (state.phase === "place") crumbs.push({ level: "place", label: state.place });
  if (state.phase === "place" && state.route) crumbs.push({ level: "street", label: "Street" });
  return crumbs.map((crumb, index) => ({ ...crumb, current: index === crumbs.length - 1 }));
}
