import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorldPhysicsRuntime,
  stepWorldPlayer,
  worldPlayerAtRouteProgress,
  worldPlayerIntersectsObstacle,
  worldPlayerRouteDistanceM,
  type WorldPhysicsRuntime,
  type WorldPlayerState,
} from "../src/world-packs/world-physics.ts";
import type {
  VerifiedWorldPack,
  WorldNavigation,
  WorldPackManifest,
  WorldPackRuntime,
} from "../src/world-packs/world-pack-types.ts";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(APP_ROOT, "..");
const PUBLIC_ROOT = path.join(APP_ROOT, "public/world-packs");
const EXPECTED_PROOF = path.join(
  REPOSITORY_ROOT,
  "docs/world-packs/proof/traversal-proof.json",
);
const ROUTE_SLUGS = ["17665674778", "15573295095", "6496900063"];
const GUIDED_REPETITIONS = 3;
const FREE_ROAM_SECONDS = 600;

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rounded(value: number, places = 6) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function loadReferencePack(routeSlug: string): VerifiedWorldPack {
  const index = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_ROOT, "index.json"), "utf8"),
  );
  const entry = index.packs[routeSlug];
  if (!entry) throw new Error(`Reference route ${routeSlug} has no World Pack.`);
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
  const artifactPaths = [
    runtime.assets.terrainCollision,
    runtime.assets.traversableSurfaces,
    runtime.assets.structuresCollision,
    runtime.assets.terrainMask,
  ].filter((logicalPath): logicalPath is string => Boolean(logicalPath));
  const artifacts = new Map(
    artifactPaths.map((logicalPath) => [
      logicalPath,
      new Uint8Array(fs.readFileSync(path.join(packRoot, logicalPath))),
    ]),
  );
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
      if (!bytes) throw new Error(`Missing proof artifact ${logicalPath}.`);
      return bytes;
    },
    artifactUrl(logicalPath) {
      return new URL(logicalPath, `https://godiesel.test${entry.basePath}`);
    },
  };
}

function guidedProof(runtime: WorldPhysicsRuntime) {
  const traceDigests: string[] = [];
  let sampleCount = 0;
  let maximumGroundingErrorM = 0;
  let declaredDiscontinuityTransitions = 0;
  for (let repetition = 0; repetition < GUIDED_REPETITIONS; repetition += 1) {
    const trace: number[][] = [];
    let previousEdgeTo: number | undefined;
    let previousPlayer: WorldPlayerState | undefined;
    for (const edge of runtime.navigation.edges) {
      const from = runtime.navigation.nodes[edge.from];
      const to = runtime.navigation.nodes[edge.to];
      const isDeclaredDiscontinuity =
        previousEdgeTo !== undefined && previousEdgeTo !== edge.from;
      if (isDeclaredDiscontinuity) declaredDiscontinuityTransitions += 1;
      const steps = Math.max(1, Math.ceil(edge.lengthM / 2));
      for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps;
        const progressM =
          from.distanceM + (to.distanceM - from.distanceM) * ratio;
        const expectedZ =
          from.position[2] + (to.position[2] - from.position[2]) * ratio;
        const player = worldPlayerAtRouteProgress(runtime, progressM);
        const groundingErrorM = Math.abs(player.z - expectedZ);
        maximumGroundingErrorM = Math.max(
          maximumGroundingErrorM,
          groundingErrorM,
        );
        if (groundingErrorM > 0.01) {
          throw new Error(
            `${runtime.worldId} edge ${edge.from}->${edge.to} at ${progressM} m has guided grounding error ${groundingErrorM} m (${player.z} m actual, ${expectedZ} m expected).`,
          );
        }
        if (worldPlayerIntersectsObstacle(runtime, player)) {
          throw new Error(
            `${runtime.worldId} edge ${edge.from}->${edge.to} at ${progressM} m enters structure collision.`,
          );
        }
        if (previousPlayer && !(isDeclaredDiscontinuity && step === 0)) {
          const movementM = Math.hypot(
            player.x - previousPlayer.x,
            player.y - previousPlayer.y,
            player.z - previousPlayer.z,
          );
          const expectedMovementM =
            step === 0
              ? 0
              : Math.hypot(
                  to.position[0] - from.position[0],
                  to.position[1] - from.position[1],
                  to.position[2] - from.position[2],
                ) / steps;
          if (movementM > expectedMovementM + 0.02) {
            throw new Error(
              `${runtime.worldId} guided traversal moved ${movementM} m without a declared discontinuity.`,
            );
          }
        }
        trace.push([
          rounded(player.x),
          rounded(player.y),
          rounded(player.z),
          rounded(player.routeProgressM),
        ]);
        previousPlayer = player;
      }
      previousEdgeTo = edge.to;
    }
    const endpoint = worldPlayerAtRouteProgress(
      runtime,
      runtime.navigation.nodes.at(-1)!.distanceM,
    );
    if (
      Math.abs(
        endpoint.routeProgressM - runtime.navigation.nodes.at(-1)!.distanceM,
      ) > 0.001
    ) {
      throw new Error(`${runtime.worldId} guided traversal did not reach the endpoint.`);
    }
    sampleCount = trace.length;
    traceDigests.push(sha256(trace));
  }
  if (new Set(traceDigests).size !== 1) {
    throw new Error(`${runtime.worldId} guided traversals are not deterministic.`);
  }
  return {
    repetitions: GUIDED_REPETITIONS,
    samplesPerTraversal: sampleCount,
    declaredDiscontinuities:
      declaredDiscontinuityTransitions / GUIDED_REPETITIONS,
    maximumGroundingErrorM: rounded(maximumGroundingErrorM, 9),
    obstacleIntersections: 0,
    unexplainedTeleportations: 0,
    endpointReached: true,
    traceSha256: traceDigests[0],
  };
}

function freeRoamInput(tick: number, evasiveTicks: number) {
  if (evasiveTicks > 0) {
    return { forward: 1 as const, strafe: 1 as const, turn: 1 as const, run: false };
  }
  const phase = Math.floor(tick / 300) % 8;
  return {
    forward: 1 as const,
    strafe: phase === 2 ? (1 as const) : phase === 6 ? (-1 as const) : (0 as const),
    turn: phase === 1 || phase === 2 ? (1 as const) : phase === 5 || phase === 6 ? (-1 as const) : (0 as const),
    run: tick % 11 === 0,
  };
}

function selectFreeRoamStart(runtime: WorldPhysicsRuntime) {
  const nodeStride = Math.max(1, Math.floor(runtime.navigation.nodes.length / 24));
  const headingOffsets = [90, -90, 45, -45];
  for (
    let nodeIndex = 0;
    nodeIndex < runtime.navigation.nodes.length;
    nodeIndex += nodeStride
  ) {
    const node = runtime.navigation.nodes[nodeIndex];
    for (const headingOffset of headingOffsets) {
      const initial = worldPlayerAtRouteProgress(runtime, node.distanceM);
      let probe = {
        ...initial,
        headingDeg: (initial.headingDeg + headingOffset + 360) % 360,
      };
      let maximumRouteDistanceM = 0;
      for (let tick = 0; tick < runtime.navigation.fixedTimestepHz * 12; tick += 1) {
        probe = stepWorldPlayer(runtime, probe, {
          forward: 1,
          strafe: 0,
          turn: 0,
          run: false,
        });
        maximumRouteDistanceM = Math.max(
          maximumRouteDistanceM,
          worldPlayerRouteDistanceM(runtime, probe),
        );
        if (probe.recoveryCount > 0) break;
      }
      if (maximumRouteDistanceM > 20 && probe.recoveryCount === 0) {
        return {
          state: {
            ...initial,
            headingDeg: (initial.headingDeg + headingOffset + 360) % 360,
          },
          nodeId: node.id,
          headingOffsetDeg: headingOffset,
        };
      }
    }
  }
  throw new Error(`${runtime.worldId} has no valid 20 m free-roam entry.`);
}

function freeRoamProof(runtime: WorldPhysicsRuntime) {
  const entry = selectFreeRoamStart(runtime);
  let state = entry.state;
  const ticks = FREE_ROAM_SECONDS * runtime.navigation.fixedTimestepHz;
  const visitedCells = new Set<string>();
  const traceCheckpoints: number[][] = [];
  let maximumRouteDistanceM = 0;
  let classifiedRecoveries = 0;
  let longestBlockedRunTicks = 0;
  let blockedRunTicks = 0;
  let evasiveTicks = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const next = stepWorldPlayer(runtime, state, freeRoamInput(tick, evasiveTicks));
    const recovered = next.recoveryCount > state.recoveryCount;
    if (recovered) classifiedRecoveries += 1;
    const horizontalMovementM = Math.hypot(next.x - state.x, next.y - state.y);
    const verticalMovementM = Math.abs(next.z - state.z);
    if (
      !recovered &&
      (horizontalMovementM >
        runtime.runSpeedMps / runtime.navigation.fixedTimestepHz + 0.01 ||
        verticalMovementM > runtime.navigation.actor.maximumStepM + 0.01)
    ) {
      throw new Error(
        `${runtime.worldId} free roam tick ${tick} moved ${horizontalMovementM} m horizontally and ${verticalMovementM} m vertically without recovery.`,
      );
    }
    if (worldPlayerIntersectsObstacle(runtime, next)) {
      throw new Error(`${runtime.worldId} free roam entered structure collision.`);
    }
    const blocked = next.blockedTickCount > state.blockedTickCount;
    blockedRunTicks = blocked ? blockedRunTicks + 1 : 0;
    longestBlockedRunTicks = Math.max(longestBlockedRunTicks, blockedRunTicks);
    evasiveTicks = blocked ? 120 : Math.max(0, evasiveTicks - 1);
    const routeDistanceM = worldPlayerRouteDistanceM(runtime, next);
    maximumRouteDistanceM = Math.max(maximumRouteDistanceM, routeDistanceM);
    visitedCells.add(`${Math.floor(next.x / 25)}:${Math.floor(next.y / 25)}`);
    if (tick % runtime.navigation.fixedTimestepHz === 0) {
      traceCheckpoints.push([
        tick,
        rounded(next.x),
        rounded(next.y),
        rounded(next.z),
        next.recoveryCount,
        next.blockedTickCount,
      ]);
    }
    state = next;
  }
  if (maximumRouteDistanceM <= 15) {
    throw new Error(
      `${runtime.worldId} free roam reached only ${maximumRouteDistanceM} m from route across ${visitedCells.size} cells with ${state.blockedTickCount} blocked ticks and ${classifiedRecoveries} recoveries.`,
    );
  }
  if (longestBlockedRunTicks >= runtime.navigation.fixedTimestepHz * 10) {
    throw new Error(`${runtime.worldId} free roam remained blocked for ten seconds.`);
  }
  return {
    entryNodeId: entry.nodeId,
    entryHeadingOffsetDeg: entry.headingOffsetDeg,
    durationSeconds: FREE_ROAM_SECONDS,
    ticks,
    maximumRouteDistanceM: rounded(maximumRouteDistanceM, 3),
    visited25mCells: visitedCells.size,
    classifiedRecoveries,
    longestBlockedRunTicks,
    obstacleIntersections: 0,
    unexplainedTeleportations: 0,
    traceSha256: sha256(traceCheckpoints),
  };
}

function buildProof() {
  return {
    schemaVersion: 1,
    workload: {
      guidedRepetitions: GUIDED_REPETITIONS,
      guidedMaximumSampleSpacingM: 2,
      freeRoamSeconds: FREE_ROAM_SECONDS,
      freeRoamCellSizeM: 25,
    },
    worlds: ROUTE_SLUGS.map((routeSlug) => {
      const pack = loadReferencePack(routeSlug);
      const runtime = createWorldPhysicsRuntime(pack);
      return {
        routeSlug,
        worldId: runtime.worldId,
        packId: runtime.packId,
        fixedTimestepHz: runtime.navigation.fixedTimestepHz,
        guided: guidedProof(runtime),
        freeRoam: freeRoamProof(runtime),
      };
    }),
  };
}

const proof = buildProof();
const serialized = `${JSON.stringify(proof, null, 2)}\n`;
if (process.argv.includes("--update")) {
  fs.writeFileSync(EXPECTED_PROOF, serialized);
  process.stdout.write(`Updated ${EXPECTED_PROOF}.\n`);
} else if (process.argv.includes("--print")) {
  process.stdout.write(serialized);
} else {
  const expected = fs.readFileSync(EXPECTED_PROOF, "utf8");
  if (expected !== serialized) {
    process.stderr.write(serialized);
    throw new Error(`Traversal proof differs from ${EXPECTED_PROOF}.`);
  }
  process.stdout.write(
    `Verified traversal proof for ${proof.worlds.length} sealed World Packs.\n`,
  );
}
