import type { OverlandEntry } from "@/labs/overland/model/overland-entries";

// What the pixel text boxes say. Her title and note are shown exactly as
// she wrote them; everything else is plain interface copy.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function routeNumberLabel(number: number) {
  return `No. ${String(number).padStart(3, "0")}`;
}

/** "2025-11-26" as "26 Nov 2025", read from the string so no time zone moves the day. */
export function formatEntryDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function formatKm(km: number) {
  return km.toFixed(1);
}

/** Place, date and distance: what the box says when she left no note. */
export function entryFacts(entry: OverlandEntry) {
  return `${entry.place} · ${formatEntryDate(entry.date)} · ${formatKm(entry.km)} km`;
}

export function entryBoxText(entry: OverlandEntry) {
  return entry.note ?? entryFacts(entry);
}

export function realmBoxContent(entry: OverlandEntry, progressKm: number) {
  const doneKm = Math.min(entry.km, Math.max(0, progressKm));
  return {
    heading: routeNumberLabel(entry.number),
    title: entry.title,
    progress: `${formatKm(doneKm)} / ${formatKm(entry.km)} km`,
    body: entryBoxText(entry),
  };
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function graphemes(text: string) {
  return [...segmenter.segment(text)].map(({ segment }) => segment);
}

/**
 * Lines that fit `maxWidth` as `measure` counts it. Breaks fall between
 * words; a word wider than a line is split between graphemes, so an emoji
 * is never cut in half.
 */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (text === "") return [];
  const lines: string[] = [];
  let current: string | undefined;
  for (const word of text.split(" ")) {
    const candidate = current === undefined ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== undefined) lines.push(current);
    current = "";
    for (const grapheme of graphemes(word)) {
      if (current !== "" && measure(current + grapheme) > maxWidth) {
        lines.push(current);
        current = "";
      }
      current += grapheme;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function pageLines(lines: string[], perPage = 3): string[][] {
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += perPage) {
    pages.push(lines.slice(index, index + perPage));
  }
  return pages;
}
