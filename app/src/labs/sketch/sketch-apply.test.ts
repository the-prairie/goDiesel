import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { applySketchStyle, type StyleTarget } from "@/labs/sketch/sketch-apply";
import { exploredRoutes } from "@/labs/sketch/sketch-reveal";
import { sketchStyle } from "@/labs/sketch/sketch-style";

const explored = exploredRoutes(routes).filter((route) => route.slug === "17636880071");

/** A stand-in for the map: its layers and what was done to them. */
function fakeMap(style: ReturnType<typeof sketchStyle>, extra: string[] = []) {
  const layers = new Map<string, { paint: Record<string, unknown> }>(style.layers.map((layer) => [layer.id, { paint: { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) } }]));
  for (const id of extra) layers.set(id, { paint: {} });
  const order = [...style.layers.map((layer) => layer.id), ...extra];
  const calls: string[] = [];
  const target: StyleTarget = {
    getLayer: (id) => (layers.has(id) ? {} : undefined),
    getPaintProperty: (id, name) => layers.get(id)?.paint[name],
    setPaintProperty: (id, name, value) => {
      layers.get(id)!.paint[name] = value;
      calls.push(`paint ${id}.${name}`);
    },
    addLayer: (layer, before) => {
      layers.set(layer.id, { paint: {} });
      order.splice(before ? order.indexOf(before) : order.length, 0, layer.id);
      calls.push(`add ${layer.id} before ${before}`);
    },
    removeLayer: (id) => {
      layers.delete(id);
      order.splice(order.indexOf(id), 1);
      calls.push(`remove ${id}`);
    },
    setSourceData: (id) => calls.push(`data ${id}`),
  };
  return { target, calls, order };
}

describe("applySketchStyle", () => {
  it("changes only the paint that differs when the look changes", () => {
    const from = sketchStyle({ look: "line", reveal: "line", explored });
    const { target, calls } = fakeMap(from);
    applySketchStyle(target, sketchStyle({ look: "pencil", reveal: "line", explored }));
    const changes = calls.filter((call) => !call.startsWith("data "));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((call) => call.startsWith("paint "))).toBe(true);
    expect(calls).toContain("paint background.background-color");
  });

  it("adds the wash in its place, and takes it away again", () => {
    const from = sketchStyle({ look: "line", reveal: "corridor", explored });
    const { target, calls, order } = fakeMap(from, ["building-edges"]);
    applySketchStyle(target, sketchStyle({ look: "line", reveal: "wash", explored }));
    expect(calls).toContain("add explored-wash before wood");
    expect(order.indexOf("explored-wash")).toBe(order.indexOf("wood") - 1);
    applySketchStyle(target, sketchStyle({ look: "line", reveal: "line", explored }));
    expect(calls).toContain("remove explored-wash");
    // Our own edge layer is not in the style and stays.
    expect(order).toContain("building-edges");
  });

  it("does nothing when nothing changed", () => {
    const style = sketchStyle({ look: "line", reveal: "wash", explored });
    const { target, calls } = fakeMap(style);
    applySketchStyle(target, style);
    expect(calls.filter((call) => !call.startsWith("data "))).toEqual([]);
  });
});
