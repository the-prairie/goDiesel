import type {
  VerifiedWorldPack,
  WorldNavigation,
} from "@/world-packs/world-pack-types";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BINARY_CHUNK = 0x004e4942;
const EPSILON = 1e-5;

export interface CollisionHeightfield {
  xAxis: readonly number[];
  yAxis: readonly number[];
  heights: readonly (readonly number[])[];
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}
export interface WorldObstacle {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  minimumZ: number;
  maximumZ: number;
}

export interface WorldPhysicsRuntime {
  packId: string;
  worldId: string;
  origin: {
    latitude: number;
    longitude: number;
    elevationM: number;
  };
  navigation: WorldNavigation;
  heightfield: CollisionHeightfield;
  obstacles: readonly WorldObstacle[];
  walkSpeedMps: number;
  runSpeedMps: number;
}

export interface WorldPlayerState {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  routeProgressM: number;
  checkpointNodeId: number;
  tick: number;
  recoveryCount: number;
  blockedTickCount: number;
  grounded: true;
}

export interface WorldMovementInput {
  forward: -1 | 0 | 1;
  strafe: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  run: boolean;
}

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC3";
}

interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid collision GLB: ${message}`);
}

function parseGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(bytes.byteLength >= 20, "header is truncated");
  assert(view.getUint32(0, true) === GLB_MAGIC, "magic is invalid");
  assert(view.getUint32(4, true) === GLB_VERSION, "version is unsupported");
  assert(view.getUint32(8, true) === bytes.byteLength, "declared length is wrong");
  let offset = 12;
  let document: Record<string, unknown> | undefined;
  let binary: Uint8Array | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    assert(offset + length <= bytes.byteLength, "chunk is truncated");
    const chunk = bytes.subarray(offset, offset + length);
    if (type === JSON_CHUNK) {
      document = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, unknown>;
    } else if (type === BINARY_CHUNK) {
      binary = chunk;
    }
    offset += length;
  }
  assert(document, "JSON chunk is missing");
  assert(binary, "binary chunk is missing");
  return { document, binary };
}

function typedArray<T>(value: unknown, label: string): T[] {
  assert(Array.isArray(value), `${label} is not an array`);
  return value as T[];
}

function positionRows(bytes: Uint8Array) {
  const { document, binary } = parseGlb(bytes);
  const accessors = typedArray<GltfAccessor>(document.accessors, "accessors");
  const bufferViews = typedArray<GltfBufferView>(document.bufferViews, "bufferViews");
  const accessor = accessors[0];
  assert(accessor?.componentType === 5126, "positions are not float32");
  assert(accessor.type === "VEC3", "positions are not VEC3");
  const bufferView = bufferViews[accessor.bufferView];
  assert(bufferView, "position buffer view is missing");
  const stride = bufferView.byteStride ?? 12;
  assert(stride >= 12, "position stride is too small");
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert(start + (accessor.count - 1) * stride + 12 <= binary.byteLength, "positions are truncated");
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const positions = Array.from({ length: accessor.count }, (_, index) => {
    const offset = start + index * stride;
    return [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
  });
  return { positions, document, binary };
}

function validateGridIndices(
  document: Record<string, unknown>,
  binary: Uint8Array,
  rowWidth: number,
  rowCount: number,
) {
  const accessors = typedArray<GltfAccessor>(document.accessors, "accessors");
  const bufferViews = typedArray<GltfBufferView>(document.bufferViews, "bufferViews");
  const accessor = accessors[1];
  assert(accessor?.componentType === 5125, "indices are not uint32");
  assert(accessor.type === "SCALAR", "indices are not scalar");
  const expectedCount = (rowWidth - 1) * (rowCount - 1) * 6;
  assert(accessor.count === expectedCount, "triangle count does not match the grid");
  const bufferView = bufferViews[accessor.bufferView];
  assert(bufferView, "index buffer view is missing");
  const stride = bufferView.byteStride ?? 4;
  assert(stride >= 4, "index stride is too small");
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert(start + (accessor.count - 1) * stride + 4 <= binary.byteLength, "indices are truncated");
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  let cursor = 0;
  for (let row = 0; row < rowCount - 1; row += 1) {
    for (let column = 0; column < rowWidth - 1; column += 1) {
      const lowerLeft = row * rowWidth + column;
      const upperLeft = lowerLeft + rowWidth;
      const expected = [
        lowerLeft,
        lowerLeft + 1,
        upperLeft,
        lowerLeft + 1,
        upperLeft + 1,
        upperLeft,
      ];
      for (const expectedIndex of expected) {
        assert(
          view.getUint32(start + cursor * stride, true) === expectedIndex,
          "triangle topology does not match the collision grid",
        );
        cursor += 1;
      }
    }
  }
}

export function parseCollisionHeightfield(bytes: Uint8Array): CollisionHeightfield {
  const { positions, document, binary } = positionRows(bytes);
  assert(positions.length >= 4, "terrain has too few vertices");
  const firstY = positions[0][1];
  let rowWidth = 1;
  while (
    rowWidth < positions.length &&
    Math.abs(positions[rowWidth][1] - firstY) <= EPSILON
  ) {
    rowWidth += 1;
  }
  assert(rowWidth >= 2, "terrain row has too few vertices");
  assert(positions.length % rowWidth === 0, "terrain is not a rectangular grid");
  const rowCount = positions.length / rowWidth;
  assert(rowCount >= 2, "terrain has too few rows");
  const xAxis = positions.slice(0, rowWidth).map((position) => position[0]);
  const yAxis = Array.from(
    { length: rowCount },
    (_, row) => positions[row * rowWidth][1],
  );
  assert(xAxis.every((value, index) => index === 0 || value > xAxis[index - 1]), "x axis is not increasing");
  assert(yAxis.every((value, index) => index === 0 || value > yAxis[index - 1]), "y axis is not increasing");
  const heights = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: rowWidth }, (_, column) => {
      const position = positions[row * rowWidth + column];
      assert(Math.abs(position[0] - xAxis[column]) <= EPSILON, "x grid is irregular");
      assert(Math.abs(position[1] - yAxis[row]) <= EPSILON, "y grid is irregular");
      return position[2];
    }),
  );
  validateGridIndices(document, binary, rowWidth, rowCount);
  return {
    xAxis,
    yAxis,
    heights,
    minimumX: xAxis[0],
    maximumX: xAxis.at(-1)!,
    minimumY: yAxis[0],
    maximumY: yAxis.at(-1)!,
  };
}

function axisCell(axis: readonly number[], value: number): number | undefined {
  if (value < axis[0] || value > axis.at(-1)!) return undefined;
  if (value === axis.at(-1)) return axis.length - 2;
  let lower = 0;
  let upper = axis.length - 1;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (axis[middle] <= value) lower = middle;
    else upper = middle;
  }
  return lower;
}

export function collisionSurface(
  heightfield: CollisionHeightfield,
  x: number,
  y: number,
): { heightM: number; slopeDegrees: number } | undefined {
  const column = axisCell(heightfield.xAxis, x);
  const row = axisCell(heightfield.yAxis, y);
  if (column === undefined || row === undefined) return undefined;
  const x0 = heightfield.xAxis[column];
  const x1 = heightfield.xAxis[column + 1];
  const y0 = heightfield.yAxis[row];
  const y1 = heightfield.yAxis[row + 1];
  const fx = (x - x0) / (x1 - x0);
  const fy = (y - y0) / (y1 - y0);
  const lowerLeft = heightfield.heights[row][column];
  const lowerRight = heightfield.heights[row][column + 1];
  const upperLeft = heightfield.heights[row + 1][column];
  const upperRight = heightfield.heights[row + 1][column + 1];
  let heightM: number;
  let dzdx: number;
  let dzdy: number;
  if (fx + fy <= 1) {
    heightM =
      lowerLeft + fx * (lowerRight - lowerLeft) + fy * (upperLeft - lowerLeft);
    dzdx = (lowerRight - lowerLeft) / (x1 - x0);
    dzdy = (upperLeft - lowerLeft) / (y1 - y0);
  } else {
    heightM =
      upperRight +
      (1 - fy) * (lowerRight - upperRight) +
      (1 - fx) * (upperLeft - upperRight);
    dzdx = (upperRight - upperLeft) / (x1 - x0);
    dzdy = (upperRight - lowerRight) / (y1 - y0);
  }
  return {
    heightM,
    slopeDegrees: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
  };
}

function nearestRoutePoint(navigation: WorldNavigation, x: number, y: number) {
  const nodes = navigation.nodes;
  let best = {
    distanceSquared: Number.POSITIVE_INFINITY,
    progressM: 0,
    x: nodes[0].position[0],
    y: nodes[0].position[1],
    z: nodes[0].position[2],
  };
  for (const edge of navigation.edges) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const dx = to.position[0] - from.position[0];
    const dy = to.position[1] - from.position[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((x - from.position[0]) * dx + (y - from.position[1]) * dy) /
                lengthSquared,
            ),
          );
    const projectedX = from.position[0] + dx * ratio;
    const projectedY = from.position[1] + dy * ratio;
    const distanceSquared = (x - projectedX) ** 2 + (y - projectedY) ** 2;
    if (distanceSquared < best.distanceSquared) {
      best = {
        distanceSquared,
        progressM: from.distanceM + (to.distanceM - from.distanceM) * ratio,
        x: projectedX,
        y: projectedY,
        z: from.position[2] + (to.position[2] - from.position[2]) * ratio,
      };
    }
  }
  return best;
}

function checkpointForProgress(navigation: WorldNavigation, progressM: number) {
  let checkpoint = navigation.recoveryAnchors[0];
  for (const nodeId of navigation.recoveryAnchors) {
    if (navigation.nodes[nodeId].distanceM <= progressM) checkpoint = nodeId;
  }
  return checkpoint;
}

function obstacleCollision(
  obstacles: readonly WorldObstacle[],
  x: number,
  y: number,
  z: number,
  radiusM: number,
  heightM: number,
) {
  return obstacles.some(
    (obstacle) =>
      x + radiusM > obstacle.minimumX &&
      x - radiusM < obstacle.maximumX &&
      y + radiusM > obstacle.minimumY &&
      y - radiusM < obstacle.maximumY &&
      z + heightM > obstacle.minimumZ &&
      z < obstacle.maximumZ,
  );
}

function actorSurface(
  runtime: WorldPhysicsRuntime,
  x: number,
  y: number,
) {
  const radius = runtime.navigation.actor.radiusM;
  const centre = collisionSurface(runtime.heightfield, x, y);
  if (!centre) return undefined;
  const footprint = [
    [x - radius, y],
    [x + radius, y],
    [x, y - radius],
    [x, y + radius],
  ];
  if (
    footprint.some(
      ([sampleX, sampleY]) =>
        collisionSurface(runtime.heightfield, sampleX, sampleY) === undefined,
    )
  ) {
    return undefined;
  }
  return centre;
}

export function createWorldPhysicsRuntime(pack: VerifiedWorldPack): WorldPhysicsRuntime {
  return {
    packId: pack.manifest.packId,
    worldId: pack.manifest.worldId,
    origin: pack.runtime.origin,
    navigation: pack.navigation,
    heightfield: parseCollisionHeightfield(
      pack.artifact(pack.runtime.assets.terrainCollision),
    ),
    obstacles: [],
    walkSpeedMps: 3.5,
    runSpeedMps: 6,
  };
}

export function initialWorldPlayer(runtime: WorldPhysicsRuntime): WorldPlayerState {
  const start = runtime.navigation.nodes[0];
  const surface = actorSurface(runtime, start.position[0], start.position[1]);
  if (!surface) throw new Error("World Pack route start is outside collision terrain.");
  return {
    x: start.position[0],
    y: start.position[1],
    z: surface.heightM,
    headingDeg: routeHeading(runtime.navigation, 0),
    routeProgressM: 0,
    checkpointNodeId: runtime.navigation.recoveryAnchors[0],
    tick: 0,
    recoveryCount: 0,
    blockedTickCount: 0,
    grounded: true,
  };
}

export function worldPlayerAtRouteProgress(
  runtime: WorldPhysicsRuntime,
  progressM: number,
): WorldPlayerState {
  const nodes = runtime.navigation.nodes;
  const totalDistanceM = nodes.at(-1)!.distanceM;
  const boundedProgressM = Math.min(totalDistanceM, Math.max(0, progressM));
  const edge = runtime.navigation.edges.find((candidate) => {
    const from = nodes[candidate.from];
    const to = nodes[candidate.to];
    return (
      from.distanceM <= boundedProgressM && to.distanceM >= boundedProgressM
    );
  });
  const nearestNode = nodes.reduce((best, node) =>
    Math.abs(node.distanceM - boundedProgressM) <
    Math.abs(best.distanceM - boundedProgressM)
      ? node
      : best,
  );
  const from = edge ? nodes[edge.from] : nearestNode;
  const to = edge ? nodes[edge.to] : nearestNode;
  const distance = to.distanceM - from.distanceM;
  const ratio =
    distance === 0 ? 0 : (boundedProgressM - from.distanceM) / distance;
  const x = from.position[0] + (to.position[0] - from.position[0]) * ratio;
  const y = from.position[1] + (to.position[1] - from.position[1]) * ratio;
  const surface = actorSurface(runtime, x, y);
  if (!surface)
    throw new Error("World Pack route position is outside collision terrain.");
  return {
    x,
    y,
    z: surface.heightM,
    headingDeg: routeHeading(runtime.navigation, from.id),
    routeProgressM: edge ? boundedProgressM : nearestNode.distanceM,
    checkpointNodeId: checkpointForProgress(
      runtime.navigation,
      edge ? boundedProgressM : nearestNode.distanceM,
    ),
    tick: 0,
    recoveryCount: 0,
    blockedTickCount: 0,
    grounded: true,
  };
}

function routeHeading(navigation: WorldNavigation, nodeId: number) {
  const edge =
    navigation.edges.find((candidate) => candidate.from === nodeId) ??
    navigation.edges.find((candidate) => candidate.to === nodeId);
  if (!edge) return 0;
  const from = navigation.nodes[edge.from];
  const to = navigation.nodes[edge.to];
  return (
    ((Math.atan2(
      to.position[0] - from.position[0],
      to.position[1] - from.position[1],
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}

export function recoverWorldPlayer(
  runtime: WorldPhysicsRuntime,
  state: WorldPlayerState,
): WorldPlayerState {
  const anchor = runtime.navigation.nodes[state.checkpointNodeId];
  const surface = actorSurface(runtime, anchor.position[0], anchor.position[1]);
  if (!surface) throw new Error("World Pack recovery anchor is outside collision terrain.");
  return {
    ...state,
    x: anchor.position[0],
    y: anchor.position[1],
    z: surface.heightM,
    headingDeg: routeHeading(runtime.navigation, anchor.id),
    routeProgressM: anchor.distanceM,
    tick: state.tick + 1,
    recoveryCount: state.recoveryCount + 1,
    grounded: true,
  };
}

export function rejoinWorldRoute(
  runtime: WorldPhysicsRuntime,
  state: WorldPlayerState,
): WorldPlayerState {
  const route = nearestRoutePoint(runtime.navigation, state.x, state.y);
  const surface = actorSurface(runtime, route.x, route.y);
  if (!surface) return recoverWorldPlayer(runtime, state);
  const nearestNode = runtime.navigation.nodes.reduce(
    (best, node) =>
      Math.abs(node.distanceM - route.progressM) <
      Math.abs(best.distanceM - route.progressM)
        ? node
        : best,
    runtime.navigation.nodes[0],
  );
  return {
    ...state,
    x: route.x,
    y: route.y,
    z: surface.heightM,
    headingDeg: routeHeading(runtime.navigation, nearestNode.id),
    routeProgressM: route.progressM,
    checkpointNodeId: checkpointForProgress(runtime.navigation, route.progressM),
    tick: state.tick + 1,
    grounded: true,
  };
}

export function stepWorldPlayer(
  runtime: WorldPhysicsRuntime,
  state: WorldPlayerState,
  input: WorldMovementInput,
): WorldPlayerState {
  const timestep = 1 / runtime.navigation.fixedTimestepHz;
  const headingDeg =
    (state.headingDeg + input.turn * 100 * timestep + 360) % 360;
  const heading = (headingDeg * Math.PI) / 180;
  const magnitude = Math.hypot(input.forward, input.strafe) || 1;
  const speed = input.run ? runtime.runSpeedMps : runtime.walkSpeedMps;
  const forward = (input.forward / magnitude) * speed * timestep;
  const strafe = (input.strafe / magnitude) * speed * timestep;
  const totalX = Math.sin(heading) * forward + Math.cos(heading) * strafe;
  const totalY = Math.cos(heading) * forward - Math.sin(heading) * strafe;
  const totalDistance = Math.hypot(totalX, totalY);
  const maximumSubstep = runtime.navigation.actor.radiusM * 0.45;
  const substeps = Math.max(1, Math.ceil(totalDistance / maximumSubstep));
  let x = state.x;
  let y = state.y;
  let z = state.z;
  let blocked = false;
  for (let substep = 0; substep < substeps; substep += 1) {
    const nextX = x + totalX / substeps;
    const nextY = y + totalY / substeps;
    const nextSurface = actorSurface(runtime, nextX, nextY);
    if (!nextSurface) return recoverWorldPlayer(runtime, { ...state, headingDeg });
    const stepHeight = nextSurface.heightM - z;
    if (
      stepHeight > runtime.navigation.actor.maximumStepM ||
      nextSurface.slopeDegrees > runtime.navigation.actor.maximumSlopeDegrees ||
      obstacleCollision(
        runtime.obstacles,
        nextX,
        nextY,
        nextSurface.heightM,
        runtime.navigation.actor.radiusM,
        runtime.navigation.actor.heightM,
      )
    ) {
      blocked = true;
      break;
    }
    x = nextX;
    y = nextY;
    z = nextSurface.heightM;
  }
  const route = nearestRoutePoint(runtime.navigation, x, y);
  const checkpointNodeId = checkpointForProgress(
    runtime.navigation,
    route.progressM,
  );
  return {
    ...state,
    x,
    y,
    z,
    headingDeg,
    routeProgressM: route.progressM,
    checkpointNodeId,
    tick: state.tick + 1,
    blockedTickCount: state.blockedTickCount + (blocked ? 1 : 0),
    grounded: true,
  };
}

export function worldPlayerGeodetic(
  runtime: WorldPhysicsRuntime,
  state: WorldPlayerState,
) {
  const latitudeScale = Math.PI * 6_378_137 / 180;
  const longitudeScale =
    latitudeScale * Math.cos((runtime.origin.latitude * Math.PI) / 180);
  return {
    latitude: runtime.origin.latitude + state.y / latitudeScale,
    longitude: runtime.origin.longitude + state.x / longitudeScale,
    elevationM: runtime.origin.elevationM + state.z,
  };
}
