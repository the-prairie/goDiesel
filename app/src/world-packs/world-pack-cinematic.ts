export interface WorldPackCameraKeyframe {
  camera: [number, number, number];
  frame: number;
  routePointIndex: number;
  target: [number, number, number];
}

export interface WorldPackCameraTimeline {
  durationFrames: number;
  framesPerSecond: number;
  keyframes: WorldPackCameraKeyframe[];
  schemaVersion: 1;
  timelineId: string;
}

export interface WorldPackCameraFrame {
  camera: [number, number, number];
  frame: number;
  routePointIndex: number;
  target: [number, number, number];
}

function interpolateTuple(
  left: [number, number, number],
  right: [number, number, number],
  ratio: number,
): [number, number, number] {
  return left.map(
    (value, index) => value + (right[index] - value) * ratio,
  ) as [number, number, number];
}

export function worldPackCameraFrame(
  timeline: WorldPackCameraTimeline,
  seconds: number,
): WorldPackCameraFrame {
  if (timeline.keyframes.length < 2 || timeline.framesPerSecond <= 0) {
    throw new Error("World Pack camera timeline is incomplete.");
  }
  const frame = Math.min(
    timeline.durationFrames - 1,
    Math.max(0, seconds * timeline.framesPerSecond),
  );
  const rightIndex = timeline.keyframes.findIndex(
    (keyframe) => keyframe.frame >= frame,
  );
  const right = timeline.keyframes[
    rightIndex < 0 ? timeline.keyframes.length - 1 : rightIndex
  ];
  const left = timeline.keyframes[Math.max(0, rightIndex - 1)];
  const span = right.frame - left.frame;
  const ratio = span <= 0 ? 0 : (frame - left.frame) / span;
  return {
    camera: interpolateTuple(left.camera, right.camera, ratio),
    frame,
    routePointIndex: Math.round(
      left.routePointIndex +
        (right.routePointIndex - left.routePointIndex) * ratio,
    ),
    target: interpolateTuple(left.target, right.target, ratio),
  };
}

export function worldPackCameraDurationSeconds(
  timeline: WorldPackCameraTimeline,
) {
  return timeline.durationFrames / timeline.framesPerSecond;
}
