// What a signpost tells before the jump, as the route's trailer: a first
// page of plain facts under her title, then her own note on the pages after,
// and up to three of the route's photos hung beside it. Every word is hers
// or a plain fact; nothing here writes commentary, and nothing is cut short.

import type { RouteAnnotation } from "@/domain/route";
import { formatEntryDate, routeNumberLabel, wrapText } from "@/labs/overland/model/text-box";

/** Lines on each page of her note. */
export const SIGN_STORY_LINES = 4;
export const SIGN_POLAROIDS = 3;

export type SignStoryPage =
  | { kind: "facts"; heading: string; lines: string[]; facts: string }
  | { kind: "note"; lines: string[] };

export interface SignStoryInput {
  number: number;
  title: string;
  km: number;
  date: string;
  note: string | null;
}

/** `measure` is told when the text is drawn bold, as her title is. */
export function signStoryPages(sign: SignStoryInput, maxWidth: number, measure: (text: string, bold?: boolean) => number): SignStoryPage[] {
  const first: SignStoryPage = {
    kind: "facts",
    heading: routeNumberLabel(sign.number),
    lines: wrapText(sign.title, maxWidth, (text) => measure(text, true)),
    facts: `${sign.km.toFixed(1)} km · ${formatEntryDate(sign.date)}`,
  };
  const paragraphs = (sign.note ?? "").split("\n").map((paragraph) => paragraph.trim()).filter(Boolean);
  const lines = paragraphs.flatMap((paragraph) => wrapText(paragraph, maxWidth, (text) => measure(text)));
  const pages: SignStoryPage[] = [first];
  for (let index = 0; index < lines.length; index += SIGN_STORY_LINES) {
    pages.push({ kind: "note", lines: lines.slice(index, index + SIGN_STORY_LINES) });
  }
  return pages;
}

/** The route's first photos along the way, for the signpost. */
export function signPolaroids(annotations: readonly RouteAnnotation[]): RouteAnnotation[] {
  return annotations.filter((annotation) => annotation.kind === "image" && annotation.media).slice(0, SIGN_POLAROIDS);
}
