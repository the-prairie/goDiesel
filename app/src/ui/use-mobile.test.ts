import { beforeEach, describe, expect, it, vi } from "vitest";

// Render the hook's first frame without a DOM: state starts at its initial
// value, effects have not run, and an external store reads its snapshot.
const store = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((onChange: () => void) => () => void),
  getServerSnapshot: undefined as undefined | (() => boolean),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const firstRender = {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === "function" ? (initial as () => T)() : initial,
      () => {},
    ],
    useEffect: () => {},
    useSyncExternalStore: <T,>(
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ) => {
      store.subscribe = subscribe;
      store.getServerSnapshot = getServerSnapshot as (() => boolean) | undefined;
      return getSnapshot();
    },
  };
  return { ...firstRender, default: firstRender };
});

import { useIsMobile } from "./use-mobile";

function stubViewport(matches: boolean) {
  const query = { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal("window", { matchMedia, innerWidth: matches ? 390 : 1440 });
  return { query, matchMedia };
}

describe("useIsMobile", () => {
  beforeEach(() => {
    store.subscribe = undefined;
    store.getServerSnapshot = undefined;
  });

  it("reports a phone viewport on the first render", () => {
    const { matchMedia } = stubViewport(true);
    expect(useIsMobile()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
  });

  it("reports a desktop viewport on the first render", () => {
    stubViewport(false);
    expect(useIsMobile()).toBe(false);
  });

  it("follows breakpoint changes and stops listening on unsubscribe", () => {
    const { query } = stubViewport(false);
    useIsMobile();
    const onChange = vi.fn();
    const unsubscribe = store.subscribe!(onChange);
    expect(query.addEventListener).toHaveBeenCalledWith("change", onChange);
    unsubscribe();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", onChange);
  });

  it("renders the desktop layout on the server", () => {
    stubViewport(true);
    useIsMobile();
    expect(store.getServerSnapshot?.()).toBe(false);
  });
});
