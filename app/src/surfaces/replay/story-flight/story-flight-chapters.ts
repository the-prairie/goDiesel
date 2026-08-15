import type { QuestRoute } from "@/domain/route";
import { cinematicMoments } from "@/surfaces/replay/cinematic/route-cinematic-director";

export interface ReplayStoryChapter {
  kind: ReturnType<typeof cinematicMoments>[number]["kind"];
  label: string;
  progressM: number;
  progressRatio: number;
}

export function replayStoryChapters(
  route: QuestRoute,
  totalDistanceM: number,
): ReplayStoryChapter[] {
  const chapters = cinematicMoments(route)
    .map((moment) => ({
      kind: moment.kind,
      label: moment.label,
      progressM: moment.progressRatio * totalDistanceM,
      progressRatio: moment.progressRatio,
    }))
    .sort((left, right) => left.progressRatio - right.progressRatio);

  return chapters.reduce<ReplayStoryChapter[]>((grouped, chapter) => {
    const previous = grouped.at(-1);
    if (
      previous &&
      Math.abs(previous.progressRatio - chapter.progressRatio) < 0.001
    ) {
      previous.label = `${previous.label} + ${chapter.label}`;
      return grouped;
    }
    grouped.push({ ...chapter });
    return grouped;
  }, []);
}

export function activeReplayStoryChapter(
  chapters: ReplayStoryChapter[],
  progressM: number,
) {
  let activeIndex = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.progressM > progressM) break;
    activeIndex = index;
  }
  return activeIndex;
}

export function replayClimbM(route: QuestRoute, progressM: number) {
  let climbM = 0;
  for (let index = 1; index < route.route.length; index += 1) {
    const previous = route.route[index - 1];
    const current = route.route[index];
    if (previous.d >= progressM) break;
    const segmentDistanceM = Math.max(1, current.d - previous.d);
    const completedRatio = Math.min(
      1,
      Math.max(0, (progressM - previous.d) / segmentDistanceM),
    );
    climbM += Math.max(0, current.elev - previous.elev) * completedRatio;
    if (current.d >= progressM) break;
  }
  return climbM;
}
