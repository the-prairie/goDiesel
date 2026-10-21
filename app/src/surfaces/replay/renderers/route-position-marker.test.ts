import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayMarkerPreference } from "@/data/replay-marker-preference";
import { attachRoutePositionMarker } from "./route-position-marker";
let preference: ReplayMarkerPreference;
let onChange: () => void;
const unsubscribe = vi.fn();
vi.mock("@/data/replay-marker-preference", () => ({
  getReplayMarker: () => preference,
  subscribeReplayMarker: (listener: () => void) => {
    onChange = listener;
    return unsubscribe;
  },
}));
class Element extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: Element[] = [];
  removed = false;
  src?: string;
  append(child: Element) {
    this.children.push(child);
  }
  remove() {
    this.removed = true;
  }
}
beforeEach(() => {
  preference = { kind: "dot" };
  unsubscribe.mockClear();
  vi.stubGlobal("document", { createElement: () => new Element() });
});
afterEach(() => vi.unstubAllGlobals());
const host = () => new Element() as unknown as HTMLElement;
describe("route position portrait", () => {
  it("changes the content without moving or recreating the map marker", () => {
    const marker = host();
    const dispose = attachRoutePositionMarker(marker);
    expect(marker.dataset.markerKind).toBe("dot");
    preference = { kind: "photo", photo: "data:image/jpeg;base64,AAAA" };
    onChange();
    expect(marker.dataset.markerKind).toBe("photo");
    expect(marker.children[0]).toMatchObject({ removed: true });
    expect(marker.children[1]).toMatchObject({ src: preference.photo });
    preference = { kind: "dot", photo: preference.photo };
    onChange();
    expect(marker.dataset.markerKind).toBe("dot");
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("falls back on an image error and ignores errors from replaced images", () => {
    preference = { kind: "photo", photo: "data:image/jpeg;base64,AAAA" };
    const marker = host();
    const dispose = attachRoutePositionMarker(marker);
    const first = marker.children[0];
    onChange();
    first.dispatchEvent(new Event("error"));
    expect(marker.dataset.markerKind).toBe("photo");
    marker.children[1].dispatchEvent(new Event("error"));
    expect(marker.dataset.markerKind).toBe("dot");
    dispose();
  });
});
