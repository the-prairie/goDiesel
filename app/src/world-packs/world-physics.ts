import type {
  VerifiedWorldPack,
  WorldNavigation,
} from "@/world-packs/world-pack-types";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BINARY_CHUNK = 0x004e4942;
const EPSILON = 1e-5;
const SURFACE_EPSILON = 0.002;

export interface CollisionHeightfield {
  xAxis: readonly number[];
  yAxis: readonly number[];
  heights: readonly (readonly number[])[];
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  measuredVertices?: readonly boolean[];
}
export interface WorldObstacle {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  minimumZ: number;
  maximumZ: number;
  footprint?: readonly (readonly [number, number])[];
}

interface WorldObstacleSpatialIndex {
  cellSizeM: number;
  cells: ReadonlyMap<string, readonly number[]>;
  obstacles: readonly WorldObstacle[];
}

export interface TraversableTriangle {
  positions: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
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
  traversableTriangles: readonly TraversableTriangle[];
  obstacles: readonly WorldObstacle[];
  obstacleSpatialIndex?: WorldObstacleSpatialIndex;
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
    const position = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    assert(position.every(Number.isFinite), "position is not finite");
    return position;
  });
  return { positions, document, binary };
}

function triangleIndexValues(
  document: Record<string, unknown>,
  binary: Uint8Array,
  positionCount: number,
) {
  const accessors = typedArray<GltfAccessor>(document.accessors, "accessors");
  const bufferViews = typedArray<GltfBufferView>(document.bufferViews, "bufferViews");
  const accessor = accessors[1];
  assert(accessor?.componentType === 5125, "indices are not uint32");
  assert(accessor.type === "SCALAR", "indices are not scalar");
  assert(accessor.count > 0 && accessor.count % 3 === 0, "triangle indices are invalid");
  const bufferView = bufferViews[accessor.bufferView];
  assert(bufferView, "index buffer view is missing");
  const stride = bufferView.byteStride ?? 4;
  assert(stride >= 4, "index stride is too small");
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  assert(start + (accessor.count - 1) * stride + 4 <= binary.byteLength, "indices are truncated");
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return Array.from({ length: accessor.count }, (_, index) => {
    const value = view.getUint32(start + index * stride, true);
    assert(value < positionCount, "triangle index is out of bounds");
    return value;
  });
}

export function parseTraversableSurface(bytes: Uint8Array): TraversableTriangle[] {
  const { positions, document, binary } = positionRows(bytes);
  const indices = triangleIndexValues(document, binary, positions.length);
  return Array.from({ length: indices.length / 3 }, (_, triangleIndex) => {
    const triangle = indices
      .slice(triangleIndex * 3, triangleIndex * 3 + 3)
      .map((index) => positions[index] as [number, number, number]) as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ];
    const xs = triangle.map((position) => position[0]);
    const ys = triangle.map((position) => position[1]);
    return {
      positions: triangle,
      minimumX: Math.min(...xs),
      maximumX: Math.max(...xs),
      minimumY: Math.min(...ys),
      maximumY: Math.max(...ys),
    };
  });
}

export function parseStructureObstacles(bytes: Uint8Array): WorldObstacle[] {
  const { document } = parseGlb(bytes);
  const extras = document.extras;
  assert(
    extras && typeof extras === "object" && !Array.isArray(extras),
    "structure extras are missing",
  );
  const collision = (extras as Record<string, unknown>)
    .godieselStructureCollision;
  assert(
    collision && typeof collision === "object" && !Array.isArray(collision),
    "structure collision declaration is missing",
  );
  const declaration = collision as Record<string, unknown>;
  assert(declaration.schemaVersion === 1, "structure collision version is unsupported");
  assert(
    declaration.coordinateReference === "route-local-enu-v1",
    "structure collision coordinates are unsupported",
  );
  const rawObstacles = typedArray<Record<string, unknown>>(
    declaration.obstacles,
    "structure collision obstacles",
  );
  assert(
    rawObstacles.length > 0 && rawObstacles.length <= 100_000,
    "structure collision obstacle count is invalid",
  );
  return rawObstacles.map((rawObstacle, obstacleIndex) => {
    const rawFootprint = typedArray<unknown[]>(
      rawObstacle.footprint,
      `structure obstacle ${obstacleIndex} footprint`,
    );
    assert(
      rawFootprint.length >= 3 && rawFootprint.length <= 1_000,
      `structure obstacle ${obstacleIndex} footprint size is invalid`,
    );
    const footprint = rawFootprint.map((rawPoint, pointIndex) => {
      assert(
        Array.isArray(rawPoint) &&
          rawPoint.length === 2 &&
          rawPoint.every(
            (value) => typeof value === "number" && Number.isFinite(value),
          ),
        `structure obstacle ${obstacleIndex} point ${pointIndex} is invalid`,
      );
      return [rawPoint[0], rawPoint[1]] as [number, number];
    });
    const minimumZ = rawObstacle.minimumZ;
    const maximumZ = rawObstacle.maximumZ;
    assert(
      typeof minimumZ === "number" &&
        Number.isFinite(minimumZ) &&
        typeof maximumZ === "number" &&
        Number.isFinite(maximumZ) &&
        maximumZ > minimumZ,
      `structure obstacle ${obstacleIndex} height is invalid`,
    );
    const xs = footprint.map((point) => point[0]);
    const ys = footprint.map((point) => point[1]);
    return {
      minimumX: Math.min(...xs),
      maximumX: Math.max(...xs),
      minimumY: Math.min(...ys),
      maximumY: Math.max(...ys),
      minimumZ,
      maximumZ,
      footprint,
    };
  });
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

function parseTerrainMask(
  bytes: Uint8Array,
  columns: number,
  rows: number,
): boolean[] {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  assert(value.schemaVersion === 1, "terrain mask version is unsupported");
  assert(value.columns === columns && value.rows === rows, "terrain mask grid disagrees with collision terrain");
  const runs = typedArray<unknown[]>(value.measuredRuns, "terrain mask measuredRuns");
  const measured = Array.from({ length: columns * rows }, () => false);
  let previousEnd = 0;
  for (const [index, run] of runs.entries()) {
    assert(Array.isArray(run) && run.length === 2, `terrain mask run ${index} is invalid`);
    const [start, length] = run;
    assert(Number.isInteger(start) && Number.isInteger(length), `terrain mask run ${index} is not integral`);
    assert((start as number) >= previousEnd && (length as number) > 0, `terrain mask run ${index} overlaps`);
    const end = (start as number) + (length as number);
    assert(end <= measured.length, `terrain mask run ${index} exceeds the grid`);
    measured.fill(true, start as number, end);
    previousEnd = end;
  }
  return measured;
}

export function parseCollisionHeightfield(
  bytes: Uint8Array,
  terrainMaskBytes?: Uint8Array,
): CollisionHeightfield {
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
    ...(terrainMaskBytes
      ? { measuredVertices: parseTerrainMask(terrainMaskBytes, rowWidth, rowCount) }
      : {}),
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
  if (heightfield.measuredVertices) {
    const rowWidth = heightfield.xAxis.length;
    const indices = [
      row * rowWidth + column,
      row * rowWidth + column + 1,
      (row + 1) * rowWidth + column,
      (row + 1) * rowWidth + column + 1,
    ];
    if (indices.some((index) => !heightfield.measuredVertices![index])) return undefined;
  }
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

const OBSTACLE_CELL_SIZE_M = 64;

function obstacleCellKey(cellX: number, cellY: number) {
  return `${cellX}:${cellY}`;
}

function createObstacleSpatialIndex(
  obstacles: readonly WorldObstacle[],
): WorldObstacleSpatialIndex {
  const cells = new Map<string, number[]>();
  obstacles.forEach((obstacle, obstacleIndex) => {
    const minimumCellX = Math.floor(obstacle.minimumX / OBSTACLE_CELL_SIZE_M);
    const maximumCellX = Math.floor(obstacle.maximumX / OBSTACLE_CELL_SIZE_M);
    const minimumCellY = Math.floor(obstacle.minimumY / OBSTACLE_CELL_SIZE_M);
    const maximumCellY = Math.floor(obstacle.maximumY / OBSTACLE_CELL_SIZE_M);
    for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        const key = obstacleCellKey(cellX, cellY);
        const entries = cells.get(key);
        if (entries) entries.push(obstacleIndex);
        else cells.set(key, [obstacleIndex]);
      }
    }
  });
  return { cellSizeM: OBSTACLE_CELL_SIZE_M, cells, obstacles };
}

function obstacleCandidates(
  runtime: WorldPhysicsRuntime,
  x: number,
  y: number,
  radiusM: number,
) {
  const index = runtime.obstacleSpatialIndex;
  if (!index || index.obstacles !== runtime.obstacles) return runtime.obstacles;
  const obstacleIndices = new Set<number>();
  const minimumCellX = Math.floor((x - radiusM) / index.cellSizeM);
  const maximumCellX = Math.floor((x + radiusM) / index.cellSizeM);
  const minimumCellY = Math.floor((y - radiusM) / index.cellSizeM);
  const maximumCellY = Math.floor((y + radiusM) / index.cellSizeM);
  for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
    for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
      for (const obstacleIndex of
        index.cells.get(obstacleCellKey(cellX, cellY)) ?? []) {
        obstacleIndices.add(obstacleIndex);
      }
    }
  }
  return Array.from(obstacleIndices, (obstacleIndex) => runtime.obstacles[obstacleIndex]);
}

function obstacleCollision(
  runtime: WorldPhysicsRuntime,
  x: number,
  y: number,
  z: number,
  radiusM: number,
  heightM: number,
) {
  function pointInside(
    footprint: readonly (readonly [number, number])[],
    pointX: number,
    pointY: number,
  ) {
    let inside = false;
    for (
      let index = 0, previous = footprint.length - 1;
      index < footprint.length;
      previous = index, index += 1
    ) {
      const [x0, y0] = footprint[index];
      const [x1, y1] = footprint[previous];
      if (
        (y0 > pointY) !== (y1 > pointY) &&
        pointX < ((x1 - x0) * (pointY - y0)) / (y1 - y0) + x0
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  function segmentDistanceSquared(
    pointX: number,
    pointY: number,
    from: readonly [number, number],
    to: readonly [number, number],
  ) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((pointX - from[0]) * dx + (pointY - from[1]) * dy) /
                lengthSquared,
            ),
          );
    const nearestX = from[0] + ratio * dx;
    const nearestY = from[1] + ratio * dy;
    return (pointX - nearestX) ** 2 + (pointY - nearestY) ** 2;
  }

  return obstacleCandidates(runtime, x, y, radiusM).some((obstacle) => {
    if (
      x + radiusM <= obstacle.minimumX ||
      x - radiusM >= obstacle.maximumX ||
      y + radiusM <= obstacle.minimumY ||
      y - radiusM >= obstacle.maximumY ||
      z + heightM <= obstacle.minimumZ ||
      z >= obstacle.maximumZ
    ) {
      return false;
    }
    if (!obstacle.footprint) return true;
    return (
      pointInside(obstacle.footprint, x, y) ||
      obstacle.footprint.some((point, index) =>
        segmentDistanceSquared(
          x,
          y,
          point,
          obstacle.footprint![
            (index + 1) % obstacle.footprint!.length
          ],
        ) < radiusM ** 2,
      )
    );
  });
}

function traversableSurface(
  triangles: readonly TraversableTriangle[],
  x: number,
  y: number,
  preferredZ: number,
) {
  const candidates = [];
  for (const triangle of triangles) {
    if (
      x < triangle.minimumX - SURFACE_EPSILON ||
      x > triangle.maximumX + SURFACE_EPSILON ||
      y < triangle.minimumY - SURFACE_EPSILON ||
      y > triangle.maximumY + SURFACE_EPSILON
    ) continue;
    const [a, b, c] = triangle.positions;
    const denominator =
      (b[1] - c[1]) * (a[0] - c[0]) +
      (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) <= EPSILON) continue;
    const wa =
      ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) /
      denominator;
    const wb =
      ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) /
      denominator;
    const wc = 1 - wa - wb;
    if (
      wa < -SURFACE_EPSILON ||
      wb < -SURFACE_EPSILON ||
      wc < -SURFACE_EPSILON
    ) continue;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.abs(nz) <= EPSILON) continue;
    candidates.push({
      heightM: wa * a[2] + wb * b[2] + wc * c[2],
      slopeDegrees: (Math.atan(Math.hypot(nx, ny) / Math.abs(nz)) * 180) / Math.PI,
    });
  }
  return candidates.reduce<
    { heightM: number; slopeDegrees: number } | undefined
  >(
    (best, candidate) =>
      !best || Math.abs(candidate.heightM - preferredZ) < Math.abs(best.heightM - preferredZ)
        ? candidate
        : best,
    undefined,
  );
}

function supportSurface(
  runtime: WorldPhysicsRuntime,
  x: number,
  y: number,
  preferredZ: number,
) {
  return (
    traversableSurface(runtime.traversableTriangles, x, y, preferredZ) ??
    collisionSurface(runtime.heightfield, x, y)
  );
}

function actorSurface(
  runtime: WorldPhysicsRuntime,
  x: number,
  y: number,
  preferredZ: number,
) {
  const radius = runtime.navigation.actor.radiusM;
  const centre = supportSurface(runtime, x, y, preferredZ);
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
        supportSurface(runtime, sampleX, sampleY, centre.heightM) === undefined,
    )
  ) {
    return undefined;
  }
  return centre;
}

export function createWorldPhysicsRuntime(pack: VerifiedWorldPack): WorldPhysicsRuntime {
  const obstacles =
    pack.runtime.physicalCapabilities.structuresCollision === "footprint-prisms"
      ? parseStructureObstacles(
          pack.artifact(pack.runtime.assets.structuresCollision),
        )
      : [];
  return {
    packId: pack.manifest.packId,
    worldId: pack.manifest.worldId,
    origin: pack.runtime.origin,
    navigation: pack.navigation,
    heightfield: parseCollisionHeightfield(
      pack.artifact(pack.runtime.assets.terrainCollision),
      pack.runtime.assets.terrainMask
        ? pack.artifact(pack.runtime.assets.terrainMask)
        : undefined,
    ),
    traversableTriangles: parseTraversableSurface(
      pack.artifact(pack.runtime.assets.traversableSurfaces),
    ),
    obstacles,
    obstacleSpatialIndex: createObstacleSpatialIndex(obstacles),
    walkSpeedMps: 3.5,
    runSpeedMps: 6,
  };
}

export function initialWorldPlayer(runtime: WorldPhysicsRuntime): WorldPlayerState {
  const start = runtime.navigation.nodes[0];
  const surface = supportSurface(
    runtime,
    start.position[0],
    start.position[1],
    start.position[2],
  );
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
  const routeZ = from.position[2] + (to.position[2] - from.position[2]) * ratio;
  const surface = supportSurface(runtime, x, y, routeZ);
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
  const surface = supportSurface(
    runtime,
    anchor.position[0],
    anchor.position[1],
    anchor.position[2],
  );
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
  const surface = supportSurface(runtime, route.x, route.y, route.z);
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
    const nextSurface = actorSurface(runtime, nextX, nextY, z);
    if (!nextSurface) return recoverWorldPlayer(runtime, { ...state, headingDeg });
    const stepHeight = nextSurface.heightM - z;
    if (
      stepHeight > runtime.navigation.actor.maximumStepM ||
      nextSurface.slopeDegrees > runtime.navigation.actor.maximumSlopeDegrees ||
      obstacleCollision(
        runtime,
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
