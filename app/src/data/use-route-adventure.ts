import { useEffect, useState } from "react";

import { loadAdventureForRoute } from "@/data/adventure-repository";
import { placeAdventureOnRoute, type RouteAdventure } from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";

/**
 * Whether the adventure lookup for this recording has finished, and what it
 * found. A consumer that must not change course mid-way (the director) waits
 * for `settled`; the rest simply show the layer once it arrives.
 */
export function useRouteAdventureLookup(route: QuestRoute | undefined) {
  const [placed, setPlaced] = useState<{ slug: string; adventure?: RouteAdventure }>();

  useEffect(() => {
    if (!route) return;
    let active = true;
    void loadAdventureForRoute(route.slug).then((adventure) => {
      if (!active) return;
      setPlaced({ slug: route.slug, adventure: adventure && placeAdventureOnRoute(adventure, route) });
    });
    return () => {
      active = false;
    };
  }, [route]);

  const current = placed?.slug === route?.slug ? placed : undefined;
  return { settled: current !== undefined, adventure: current?.adventure };
}

/** The adventure layer placed on this recording, once it has loaded. */
export function useRouteAdventure(route: QuestRoute | undefined) {
  return useRouteAdventureLookup(route).adventure;
}
