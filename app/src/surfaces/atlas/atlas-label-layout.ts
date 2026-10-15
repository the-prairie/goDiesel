import type { AtlasRegionProjection } from "@/surfaces/atlas/atlas-world";

interface LabelCandidate extends AtlasRegionProjection {
  width: number;
  height: number;
  priority: number;
  selected: boolean;
}

export function visibleAtlasLabels(
  candidates: LabelCandidate[],
  viewport: { width: number; height: number },
) {
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const compact = viewport.width < 640;
  const gap = 8;

  return [...candidates]
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.priority - a.priority || a.name.localeCompare(b.name))
    .filter((candidate) => {
      const box = {
        left: candidate.x - candidate.width / 2,
        right: candidate.x + candidate.width / 2,
        top: candidate.y - candidate.height / 2,
        bottom: candidate.y + candidate.height / 2,
      };
      const collides = placed.some(
        (other) =>
          !(
            box.right + gap <= other.left ||
            box.left >= other.right + gap ||
            box.bottom + gap <= other.top ||
            box.top >= other.bottom + gap
          ),
      );
      const inFrame =
        box.left > 8 &&
        box.right < viewport.width - 8 &&
        box.top > 8 &&
        box.bottom < viewport.height - 8;
      const blockedByToolbar = compact
        ? box.top < 250
        : box.top < 190 && box.left < Math.min(960, viewport.width * 0.72);
      const show =
        candidate.visible &&
        candidate.width > 0 &&
        candidate.height > 0 &&
        inFrame &&
        !blockedByToolbar &&
        !collides &&
        (!compact || placed.length < 5 || candidate.selected);
      if (show) placed.push(box);
      return show;
    })
    .map((candidate) => candidate.name);
}
