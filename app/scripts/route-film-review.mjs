import { PNG } from "pngjs";

export const REVIEW_SAMPLE_COUNT = 6;

export function selectReviewFrames(
  shotTimeline,
  {
    sampleCount = REVIEW_SAMPLE_COUNT,
  } = {},
) {
  validateShotTimeline(shotTimeline);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error("Review sample count must be a positive integer");
  }

  const duration = shotTimeline.at(-1).endSeconds;
  return Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const seconds = Number(
      (duration * ((sampleIndex + 0.5) / sampleCount)).toFixed(6),
    );
    const shotIndex = shotTimeline.findIndex(
      (shot) => seconds >= shot.startSeconds && seconds < shot.endSeconds,
    );
    const resolvedShotIndex = shotIndex === -1 ? shotTimeline.length - 1 : shotIndex;
    const shot = shotTimeline[resolvedShotIndex];

    return {
      ...shot,
      actIndex: resolvedShotIndex,
      filename: `review-sample-${String(sampleIndex + 1).padStart(2, "0")}-${shot.kind}.png`,
      sampleIndex,
      seconds,
      shotIndex: resolvedShotIndex,
    };
  });
}

export function validateShotTimeline(shotTimeline) {
  if (!Array.isArray(shotTimeline) || shotTimeline.length === 0) {
    throw new Error("The route film must expose a cinematic shot timeline");
  }

  for (const [index, shot] of shotTimeline.entries()) {
    const previous = shotTimeline[index - 1];
    if (
      !/^[a-z][a-z-]*$/.test(shot.kind) ||
      !Number.isFinite(shot.startSeconds) ||
      !Number.isFinite(shot.endSeconds) ||
      shot.startSeconds < 0 ||
      shot.endSeconds <= shot.startSeconds ||
      (index === 0 && shot.startSeconds !== 0) ||
      (previous &&
        Math.abs(shot.startSeconds - previous.endSeconds) > 0.000001)
    ) {
      throw new Error(`Cinematic act ${index + 1} has invalid timing`);
    }
  }
}

export function reviewFrameFailures(
  frames,
  sampleCount = REVIEW_SAMPLE_COUNT,
) {
  const failures = [];
  if (!Array.isArray(frames) || frames.length !== sampleCount) {
    failures.push(`expected ${sampleCount} reviewed frames, received ${frames?.length ?? 0}`);
  }

  for (let index = 0; index < sampleCount; index += 1) {
    const frame = frames?.[index];
    if (!frame) {
      failures.push(`sample ${index + 1} was not captured`);
      continue;
    }
    if (frame.settled !== true || frame.stable !== true) {
      failures.push(`sample ${index + 1} did not stabilize`);
    }
    if (frame.qualityPassed !== true) {
      failures.push(`sample ${index + 1} failed visual quality`);
    }
  }
  return failures;
}

export function assertReviewPassed(
  frames,
  sampleCount = REVIEW_SAMPLE_COUNT,
) {
  const failures = reviewFrameFailures(frames, sampleCount);
  if (failures.length > 0) {
    throw new Error(`Route film review failed: ${failures.join("; ")}`);
  }
}

export function failedReviewEvidence(evidence, failures) {
  const { contactSheet: _contactSheet, ...failedEvidence } = evidence;
  return {
    ...failedEvidence,
    failures: Array.from(new Set(failures)),
    status: "failed",
  };
}

export function createContactSheet(images, { columns = 3 } = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("A contact sheet requires at least one image");
  }
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error("Contact sheet columns must be a positive integer");
  }

  const decoded = images.map((image) => PNG.sync.read(image));
  const { width, height } = decoded[0];
  if (
    width < 1 ||
    height < 1 ||
    decoded.some((image) => image.width !== width || image.height !== height)
  ) {
    throw new Error("Contact sheet images must have identical dimensions");
  }

  const rows = Math.ceil(decoded.length / columns);
  const sheet = new PNG({
    height: height * rows,
    width: width * columns,
  });
  sheet.data.fill(0);

  decoded.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (let y = 0; y < height; y += 1) {
      const sourceStart = y * width * 4;
      const targetStart =
        ((row * height + y) * sheet.width + column * width) * 4;
      image.data.copy(
        sheet.data,
        targetStart,
        sourceStart,
        sourceStart + width * 4,
      );
    }
  });

  return PNG.sync.write(sheet);
}
