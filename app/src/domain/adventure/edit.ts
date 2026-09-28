// What an owner may change in an imported adventure. Runtime-import free: the
// local writer loads this directly to refuse anything else.

import type { Adventure } from "@/domain/adventure/contract";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Owners adjust wording, placement along the same recording, and which clip
 * belongs to which chapter. The recordings covered, the media and its digests,
 * scene credits and the pack's provenance come only from the importer.
 */
export function checkAdventureEdit(saved: Adventure, next: Adventure): string[] {
  const problems: string[] = [];
  if (next.id !== saved.id) problems.push("The adventure id cannot change.");
  if (!same(next.source, saved.source)) problems.push("The prepared-pack source cannot change.");
  if (!same(next.legs, saved.legs)) problems.push("The recordings (legs) an adventure covers cannot change here.");
  if (!same(next.footage, saved.footage)) problems.push("footage and its digests come only from the importer.");
  if (!same(next.scenes.map(({ anchor: _anchor, ...scene }) => scene), saved.scenes.map(({ anchor: _anchor, ...scene }) => scene))) {
    problems.push("A captured scene's model, credit and tour come only from the importer.");
  }
  if (!same(next.chapters.map((chapter) => chapter.id), saved.chapters.map((chapter) => chapter.id))) {
    problems.push("chapters cannot be added, removed or reordered here.");
  }
  for (const chapter of next.chapters) {
    const before = saved.chapters.find((item) => item.id === chapter.id);
    if (before && before.anchor.slug !== chapter.anchor.slug) {
      problems.push(`Chapter ${chapter.id} cannot move to another recording.`);
    }
  }
  for (const scene of next.scenes) {
    const before = saved.scenes.find((item) => item.id === scene.id);
    if (before && before.anchor.slug !== scene.anchor.slug) {
      problems.push(`Scene ${scene.id} cannot move to another recording.`);
    }
  }
  return problems;
}
