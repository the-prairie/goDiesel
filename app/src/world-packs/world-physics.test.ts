import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collisionSurface,
  createWorldPhysicsRuntime,
  initialWorldPlayer,
  parseCollisionHeightfield,
  parseStructureObstacles,
  rejoinWorldRoute,
  stepWorldPlayer,
  worldPlayerAtRouteProgress,
  type WorldPhysicsRuntime,
} from "@/world-packs/world-physics";
import type {
  VerifiedWorldPack,
  WorldNavigation,
  WorldPackManifest,
  WorldPackRuntime,
} from "@/world-packs/world-pack-types";

const PUBLIC_ROOT = path.resolve(
  import.meta.dirname,
  "../../public/world-packs",
);

function structureCollisionFixture() {
  const document = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      extras: {
        godieselStructureCollision: {
          schemaVersion: 1,
          coordinateReference: "route-local-enu-v1",
          obstacles: [
            {
              footprint: [
                [0.6, -0.1],
                [0.8, 0.1],
                [0.6, 0.3],
                [0.4, 0.1],
              ],
              minimumZ: -20,
              maximumZ: 20,
            },
          ],
        },
      },
    }),
  );
  const jsonLength = Math.ceil(document.length / 4) * 4;
  const binaryLength = 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(document, 20);
  view.setUint32(20 + jsonLength, binaryLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  return bytes;
}

function referencePack(routeSlug: string): VerifiedWorldPack {
  const index = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_ROOT, "index.json"), "utf8"),
  );
  const entry = index.packs[routeSlug];
  const packRoot = path.join(PUBLIC_ROOT, entry.worldId, entry.packId);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packRoot, "manifest.json"), "utf8"),
  ) as WorldPackManifest;
  const runtime = JSON.parse(
    fs.readFileSync(path.join(packRoot, manifest.runtime.entrypoint), "utf8"),
  ) as WorldPackRuntime;
  const navigation = JSON.parse(
    fs.readFileSync(path.join(packRoot, runtime.assets.navigation), "utf8"),
  ) as WorldNavigation;
  const collision = new Uint8Array(
    fs.readFileSync(path.join(packRoot, runtime.assets.terrainCollision)),
  );
  const traversable = new Uint8Array(
    fs.readFileSync(path.join(packRoot, runtime.assets.traversableSurfaces)),
  );
  const structuresCollision = new Uint8Array(
    fs.readFileSync(path.join(packRoot, runtime.assets.structuresCollision)),
  );
  const terrainMask = runtime.assets.terrainMask
    ? new Uint8Array(
        fs.readFileSync(path.join(packRoot, runtime.assets.terrainMask)),
      )
    : undefined;
  const artifacts = new Map([
    [runtime.assets.terrainCollision, collision],
    [runtime.assets.traversableSurfaces, traversable],
    [runtime.assets.structuresCollision, structuresCollision],
    ...(terrainMask && runtime.assets.terrainMask
      ? ([[runtime.assets.terrainMask, terrainMask]] as const)
      : []),
  ]);
  return {
    entry,
    baseUrl: new URL(`https://godiesel.test${entry.basePath}`),
    manifest,
    runtime,
    navigation,
    canonicalRoute: {} as VerifiedWorldPack["canonicalRoute"],
    artifacts,
    artifact(logicalPath) {
      const bytes = artifacts.get(logicalPath);
      if (!bytes) throw new Error(`missing fixture artifact: ${logicalPath}`);
      return bytes;
    },
    artifactUrl(logicalPath) {
      return new URL(logicalPath, `https://godiesel.test${entry.basePath}`);
    },
  };
}

describe("World Pack collision runtime", () => {
  it("parses declared polygon-prism structure collision", () => {
    const obstacles = parseStructureObstacles(structureCollisionFixture());

    expect(obstacles).toHaveLength(1);
    expect(obstacles[0]).toMatchObject({
      minimumX: 0.4,
      maximumX: 0.8,
      minimumY: -0.1,
      maximumY: 0.3,
      minimumZ: -20,
      maximumZ: 20,
    });
  });
  for (const routeSlug of ["17665674778", "15573295095", "6496900063"]) {
    it(`parses and grounds the separate collision terrain for ${routeSlug}`, () => {
      const pack = referencePack(routeSlug);
      const heightfield = parseCollisionHeightfield(
        pack.artifact(pack.runtime.assets.terrainCollision),
      );
      const runtime = createWorldPhysicsRuntime(pack);
      const player = initialWorldPlayer(runtime);

      expect(heightfield.xAxis.length).toBeGreaterThan(2);
      expect(heightfield.yAxis.length).toBeGreaterThan(2);
      expect(player.z).toBeCloseTo(runtime.navigation.nodes[0].position[2], 2);
      expect(player.grounded).toBe(true);
    });

    it(`supports every recorded route node without elevation drift for ${routeSlug}`, () => {
      const runtime = createWorldPhysicsRuntime(referencePack(routeSlug));

      const maximumErrorM = Math.max(
        ...runtime.navigation.nodes.map((node) => {
          const player = worldPlayerAtRouteProgress(runtime, node.distanceM);
          return Math.abs(player.z - node.position[2]);
        }),
      );

      expect(maximumErrorM).toBeLessThanOrEqual(0.01);
    });
  }

  it("is byte-for-byte deterministic over a long mixed-input traversal", () => {
    const runtime = createWorldPhysicsRuntime(referencePack("17665674778"));
    expect(runtime.obstacleSpatialIndex?.cells.size).toBeGreaterThan(1);
    const run = () => {
      let state = initialWorldPlayer(runtime);
      for (let tick = 0; tick < 12_000; tick += 1) {
        state = stepWorldPlayer(runtime, state, {
          forward: tick % 600 < 480 ? 1 : -1,
          strafe: tick % 240 < 120 ? 1 : -1,
          turn: tick % 360 < 180 ? 1 : -1,
          run: tick % 5 === 0,
        });
        expect(Number.isFinite(state.z)).toBe(true);
        expect(state.grounded).toBe(true);
      }
      return state;
    };

    expect(run()).toEqual(run());
  });

  it("blocks coastal no-data water outside the authoritative route ribbon", () => {
    const runtime = createWorldPhysicsRuntime(referencePack("6496900063"));
    const validity = runtime.heightfield.measuredVertices;
    expect(validity).toBeDefined();
    const index = validity!.findIndex((measured) => !measured);
    expect(index).toBeGreaterThanOrEqual(0);
    const row = Math.floor(index / runtime.heightfield.xAxis.length);
    const column = index % runtime.heightfield.xAxis.length;

    expect(
      collisionSurface(
        runtime.heightfield,
        runtime.heightfield.xAxis[
          Math.min(column, runtime.heightfield.xAxis.length - 2)
        ],
        runtime.heightfield.yAxis[
          Math.min(row, runtime.heightfield.yAxis.length - 2)
        ],
      ),
    ).toBeUndefined();
  });

  it("cannot tunnel through a structure obstacle at an extreme test speed", () => {
    const base = createWorldPhysicsRuntime(referencePack("17665674778"));
    const runtime: WorldPhysicsRuntime = {
      ...base,
      walkSpeedMps: 60,
      runSpeedMps: 60,
      obstacles: [
        {
          minimumX: 0.6,
          maximumX: 0.8,
          minimumY: -2,
          maximumY: 2,
          minimumZ: -20,
          maximumZ: 20,
        },
      ],
    };
    const start = { ...initialWorldPlayer(runtime), headingDeg: 90 };
    const result = stepWorldPlayer(runtime, start, {
      forward: 1,
      strafe: 0,
      turn: 0,
      run: true,
    });

    expect(result.x).toBeLessThanOrEqual(
      0.6 - runtime.navigation.actor.radiusM,
    );
    expect(result.blockedTickCount).toBe(1);
  });

  it("blocks slopes beyond the actor contract", () => {
    const base = createWorldPhysicsRuntime(referencePack("17665674778"));
    const runtime: WorldPhysicsRuntime = {
      ...base,
      heightfield: {
        xAxis: [-1, 1],
        yAxis: [-1, 1],
        heights: [
          [-10, 10],
          [-10, 10],
        ],
        minimumX: -1,
        maximumX: 1,
        minimumY: -1,
        maximumY: 1,
      },
      traversableTriangles: [],
    };
    const start = {
      ...initialWorldPlayer(runtime),
      x: 0,
      y: 0,
      z: 0,
      headingDeg: 90,
    };
    const result = stepWorldPlayer(runtime, start, {
      forward: 1,
      strafe: 0,
      turn: 0,
      run: false,
    });

    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
    expect(result.blockedTickCount).toBe(1);
  });

  it("blocks downward support-layer snaps beyond the actor step contract", () => {
    const base = createWorldPhysicsRuntime(referencePack("17665674778"));
    const runtime: WorldPhysicsRuntime = {
      ...base,
      heightfield: {
        xAxis: [-10, 10],
        yAxis: [-10, 10],
        heights: [
          [0, 0],
          [0, 0],
        ],
        minimumX: -10,
        maximumX: 10,
        minimumY: -10,
        maximumY: 10,
      },
      traversableTriangles: [
        {
          positions: [
            [-10, -10, -2],
            [10, -10, -2],
            [0, 10, -2],
          ],
          minimumX: -10,
          maximumX: 10,
          minimumY: -10,
          maximumY: 10,
        },
      ],
      obstacles: [],
    };
    const start = {
      ...initialWorldPlayer(base),
      x: 0,
      y: 0,
      z: 0,
      headingDeg: 90,
    };

    const result = stepWorldPlayer(runtime, start, {
      forward: 1,
      strafe: 0,
      turn: 0,
      run: false,
    });

    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
    expect(result.blockedTickCount).toBe(1);
  });

  it("blocks a valid move into declared no-data without recovering", () => {
    const base = createWorldPhysicsRuntime(referencePack("6496900063"));
    const runtime: WorldPhysicsRuntime = {
      ...base,
      heightfield: {
        xAxis: [-2, 0, 2],
        yAxis: [-2, 2],
        heights: [
          [0, 0, 0],
          [0, 0, 0],
        ],
        minimumX: -2,
        maximumX: 2,
        minimumY: -2,
        maximumY: 2,
        measuredVertices: [true, true, false, true, true, false],
      },
      traversableTriangles: [],
      obstacles: [],
    };
    let state = {
      ...initialWorldPlayer(base),
      x: -1,
      y: 0,
      z: 0,
      headingDeg: 90,
    };
    while (state.blockedTickCount === 0) {
      state = stepWorldPlayer(runtime, state, {
        forward: 1,
        strafe: 0,
        turn: 0,
        run: true,
      });
    }

    expect(state.recoveryCount).toBe(0);
    expect(state.blockedTickCount).toBe(1);
    expect(state.x).toBeLessThan(0);
  });

  it("recovers an already invalid world-edge state to a checkpoint", () => {
    const runtime = createWorldPhysicsRuntime(referencePack("6496900063"));
    const start = initialWorldPlayer(runtime);
    const edgeY =
      (runtime.heightfield.minimumY + runtime.heightfield.maximumY) / 2;
    const edgeSurface = collisionSurface(
      runtime.heightfield,
      runtime.heightfield.maximumX - 0.001,
      edgeY,
    )!;
    const result = stepWorldPlayer(
      runtime,
      {
        ...start,
        x: runtime.heightfield.maximumX - 0.001,
        y: edgeY,
        z: edgeSurface.heightM,
        headingDeg: 90,
      },
      { forward: 1, strafe: 0, turn: 0, run: true },
    );

    expect(result.recoveryCount).toBe(1);
    expect(result.x).toBe(runtime.navigation.nodes[0].position[0]);
    expect(result.y).toBe(runtime.navigation.nodes[0].position[1]);
    expect(
      collisionSurface(runtime.heightfield, result.x, result.y),
    ).toBeDefined();
  });

  it("rejoins exact route endpoints repeatedly without positional drift", () => {
    const runtime = createWorldPhysicsRuntime(referencePack("15573295095"));
    const first = runtime.navigation.nodes[0];
    const last = runtime.navigation.nodes.at(-1)!;
    let state = initialWorldPlayer(runtime);

    for (let leg = 0; leg < 20; leg += 1) {
      const target = leg % 2 === 0 ? last : first;
      state = rejoinWorldRoute(runtime, {
        ...state,
        x: target.position[0],
        y: target.position[1],
        z: target.position[2],
      });
      expect(state.x).toBeCloseTo(target.position[0], 10);
      expect(state.y).toBeCloseTo(target.position[1], 10);
      expect(state.routeProgressM).toBeCloseTo(target.distanceM, 8);
    }

    expect(state.x).toBeCloseTo(first.position[0], 10);
    expect(state.y).toBeCloseTo(first.position[1], 10);
  });

  it("snaps to recorded evidence instead of interpolating across a route gap", () => {
    const base = createWorldPhysicsRuntime(referencePack("17665674778"));
    const runtime: WorldPhysicsRuntime = {
      ...base,
      navigation: {
        ...base.navigation,
        edges: base.navigation.edges.filter(
          (edge) =>
            !(edge.from === 207 && edge.to === 208) &&
            !(edge.from === 274 && edge.to === 275),
        ),
      },
    };
    const before = runtime.navigation.nodes[207];
    const after = runtime.navigation.nodes[208];
    const gapProgressM = (before.distanceM + after.distanceM) / 2;

    const player = worldPlayerAtRouteProgress(runtime, gapProgressM);

    expect(player.routeProgressM).toBe(before.distanceM);
    expect(player.x).toBe(before.position[0]);
    expect(player.y).toBe(before.position[1]);
  });
});
