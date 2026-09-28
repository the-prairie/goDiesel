import { useEffect, useState } from "react";

import { loadAdventureForRoute } from "@/data/adventure-repository";
import { placeAdventureOnRoute, type RouteAdventure } from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";

/** The adventure layer placed on this recording, once it has loaded. */
export function useRouteAdventure(route: QuestRoute | undefined) {
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

  return placed?.slug === route?.slug ? placed?.adventure : undefined;
}
