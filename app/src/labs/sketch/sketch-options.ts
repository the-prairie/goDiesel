// The owner's review options, kept in the URL so a link reopens the same
// comparison. The review control itself shows only with `review=1`.

import type { RevealMode } from "@/labs/sketch/sketch-reveal";

export type SketchLook = "line" | "pencil";

export interface SketchOptions {
  review: boolean;
  look: SketchLook;
  reveal: RevealMode;
}

const LOOKS: readonly SketchLook[] = ["line", "pencil"];
const REVEALS: readonly RevealMode[] = ["line", "corridor", "wash"];

export function sketchOptions(params: URLSearchParams): SketchOptions {
  const look = params.get("look");
  const reveal = params.get("reveal");
  return {
    review: params.get("review") === "1",
    look: LOOKS.find((candidate) => candidate === look) ?? "line",
    reveal: REVEALS.find((candidate) => candidate === reveal) ?? "corridor",
  };
}

export function withOption(params: URLSearchParams, key: "look" | "reveal", value: string) {
  const next = new URLSearchParams(params);
  next.set(key, value);
  return next;
}
