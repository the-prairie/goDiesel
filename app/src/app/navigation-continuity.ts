import { useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

interface ScrollPosition {
  left: number;
  regions: Record<string, { left: number; top: number }>;
  top: number;
}

const scrollPositions = new Map<string, ScrollPosition>();

export function useNavigationContinuity(
  mainRef: RefObject<HTMLElement | null>,
) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPathname = useRef(location.pathname);
  const firstRender = useRef(true);

  useLayoutEffect(
    () => () => {
      scrollPositions.set(location.key, {
        left: window.scrollX,
        regions:
          scrollPositions.get(location.key)?.regions ??
          Object.fromEntries(
            Array.from(
              document.querySelectorAll<HTMLElement>("[data-navigation-scroll]"),
            ).map((region) => [
              region.dataset.navigationScroll!,
              { left: region.scrollLeft, top: region.scrollTop },
            ]),
          ),
        top: window.scrollY,
      });
    },
    [location.key],
  );

  useLayoutEffect(() => {
    const pathnameChanged = previousPathname.current !== location.pathname;
    previousPathname.current = location.pathname;

    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!pathnameChanged) return;

    const savedPosition =
      navigationType === "POP" ? scrollPositions.get(location.key) : undefined;
    const destinationManagesWindowScroll = document.querySelector(
      '[data-navigation-window-scroll="managed"]',
    );
    if (!destinationManagesWindowScroll) {
      window.scrollTo({
        behavior: "auto",
        left: savedPosition?.left ?? 0,
        top: savedPosition?.top ?? 0,
      });
    }

    const focusFrame = window.requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>("[data-navigation-scroll]")
        .forEach((region) => {
          const position = savedPosition?.regions[region.dataset.navigationScroll!];
          region.scrollTo({
            behavior: "auto",
            left: position?.left ?? 0,
            top: position?.top ?? 0,
          });
        });
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [location.key, location.pathname, mainRef, navigationType]);
}

export function useNavigationScrollRegion(
  name: string,
  regionRef: RefObject<HTMLElement | null>,
) {
  const location = useLocation();

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    return () => {
      const existing = scrollPositions.get(location.key) ?? {
        left: window.scrollX,
        regions: {},
        top: window.scrollY,
      };
      scrollPositions.set(location.key, {
        ...existing,
        regions: {
          ...existing.regions,
          [name]: { left: region.scrollLeft, top: region.scrollTop },
        },
      });
    };
  }, [location.key, name, regionRef]);
}
