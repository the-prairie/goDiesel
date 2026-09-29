import { useEffect, useState } from "react";

/**
 * Layout branch for the seed lab, modelled on `@/ui/use-mobile` but at the
 * story's own threshold.
 *
 * Rendering both a desktop and a mobile composition and hiding one with
 * `display:none` mounts BOTH - which meant two live MapLibre instances, two
 * WebGL contexts and two sets of tile requests on one page. That is the same
 * double-engine defect this redesign set out to remove from the Atlas, so the
 * day renders exactly one composition.
 */
export function useWideLayout(minWidth = 1024) {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= minWidth,
  );

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(window.innerWidth >= minWidth);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, [minWidth]);

  return wide;
}
