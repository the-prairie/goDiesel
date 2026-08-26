import { canonicalJson, sha256Hex } from "@/world-packs/canonical-json";
import type {
  CanonicalWorldRoute,
  VerifiedWorldPack,
  WorldNavigation,
  WorldPackArtifact,
  WorldPackIndexEntry,
  WorldPackLoadPhase,
  WorldPackManifest,
  WorldPackRuntime,
} from "@/world-packs/world-pack-types";

const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_BYTES = 256 * 1024 * 1024;
const PACK_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PACK_ID = /^wp_[0-9a-f]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export class WorldPackLoadError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unavailable"
      | "invalid"
      | "integrity"
      | "unsupported"
      | "too-large",
  ) {
    super(message);
    this.name = "WorldPackLoadError";
  }
}
interface LoadOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  baseHref?: string;
  onPhase?: (phase: WorldPackLoadPhase) => void;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldPackLoadError(`${label} must be an object`, "invalid");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorldPackLoadError(`${label} must have content`, "invalid");
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorldPackLoadError(`${label} must be finite`, "invalid");
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isInteger(result)) {
    throw new WorldPackLoadError(`${label} must be an integer`, "invalid");
  }
  return result;
}

function path(value: unknown, label: string): string {
  const result = string(value, label);
  if (!PACK_PATH.test(result)) {
    throw new WorldPackLoadError(`${label} is not a safe pack path`, "invalid");
  }
  return result;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new WorldPackLoadError(`${label} is not valid UTF-8 JSON`, "invalid");
  }
}

function sameOriginUrl(pathname: string, base: URL, label: string): URL {
  const url = new URL(pathname, base);
  if (url.origin !== base.origin) {
    throw new WorldPackLoadError(`${label} leaves the application origin`, "invalid");
  }
  return url;
}

async function fetchBytes(
  url: URL,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(url, { signal, credentials: "same-origin" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WorldPackLoadError(`World Pack file is unavailable: ${url.pathname}`, "unavailable");
  }
  if (!response.ok) {
    throw new WorldPackLoadError(
      `World Pack file returned HTTP ${response.status}: ${url.pathname}`,
      "unavailable",
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
    throw new WorldPackLoadError(`World Pack file is too large: ${url.pathname}`, "too-large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new WorldPackLoadError(`World Pack file is too large: ${url.pathname}`, "too-large");
  }
  return bytes;
}

function parseIndexEntry(value: unknown, routeSlug: string): WorldPackIndexEntry {
  const index = record(value, "World Pack index");
  if (index.schemaVersion !== 1) {
    throw new WorldPackLoadError("World Pack index version is unsupported", "unsupported");
  }
  const packs = record(index.packs, "World Pack index packs");
  const rawEntry = packs[routeSlug];
  if (rawEntry === undefined) {
    throw new WorldPackLoadError(`No local World Pack is published for route ${routeSlug}`, "unavailable");
  }
  const entry = record(rawEntry, "World Pack index entry");
  const packId = string(entry.packId, "World Pack index packId");
  const manifestSha256 = string(entry.manifestSha256, "World Pack index manifestSha256");
  if (!PACK_ID.test(packId) || !SHA256.test(manifestSha256)) {
    throw new WorldPackLoadError("World Pack index contains an invalid identity", "invalid");
  }
  const basePath = string(entry.basePath, "World Pack index basePath");
  if (!basePath.startsWith("/") || !basePath.endsWith("/")) {
    throw new WorldPackLoadError("World Pack basePath must be an absolute directory", "invalid");
  }
  return {
    worldId: string(entry.worldId, "World Pack index worldId"),
    packId,
    basePath,
    manifestSha256,
  };
}

function parseArtifact(value: unknown): WorldPackArtifact {
  const artifact = record(value, "World Pack artifact");
  const sha256 = string(artifact.sha256, "artifact sha256");
  if (!SHA256.test(sha256)) {
    throw new WorldPackLoadError("artifact sha256 is invalid", "invalid");
  }
  if (typeof artifact.requiredRuntime !== "boolean") {
    throw new WorldPackLoadError("artifact requiredRuntime must be boolean", "invalid");
  }
  if (artifact.kind !== "source" && artifact.kind !== "artifact") {
    throw new WorldPackLoadError("artifact kind is invalid", "invalid");
  }
  const evidenceClasses = new Set([
    "recorded",
    "derived",
    "measured",
    "reconstructed",
    "procedural",
    "unavailable",
  ]);
  if (!evidenceClasses.has(String(artifact.evidenceClass))) {
    throw new WorldPackLoadError("artifact evidenceClass is invalid", "invalid");
  }
  return {
    logicalPath: path(artifact.logicalPath, "artifact logicalPath"),
    kind: string(artifact.kind, "artifact kind") as WorldPackArtifact["kind"],
    role: string(artifact.role, "artifact role"),
    sha256,
    byteSize: integer(artifact.byteSize, "artifact byteSize"),
    mediaType: string(artifact.mediaType, "artifact mediaType"),
    formatVersion: string(artifact.formatVersion, "artifact formatVersion"),
    evidenceClass: string(artifact.evidenceClass, "artifact evidenceClass") as WorldPackArtifact["evidenceClass"],
    requiredRuntime: artifact.requiredRuntime,
    transformationIds: Array.isArray(artifact.transformationIds)
      ? artifact.transformationIds.map((value) => string(value, "transformation id"))
      : (() => {
          throw new WorldPackLoadError("artifact transformationIds must be an array", "invalid");
        })(),
  };
}

function parseManifest(value: unknown): WorldPackManifest {
  const manifest = record(value, "World Pack manifest");
  if (manifest.schemaVersion !== 1) {
    throw new WorldPackLoadError("World Pack manifest version is unsupported", "unsupported");
  }
  const artifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.map(parseArtifact)
    : (() => {
        throw new WorldPackLoadError("World Pack artifacts must be an array", "invalid");
      })();
  if (new Set(artifacts.map((artifact) => artifact.logicalPath)).size !== artifacts.length) {
    throw new WorldPackLoadError("World Pack artifact paths are not unique", "invalid");
  }
  const runtime = record(manifest.runtime, "World Pack runtime declaration");
  if (
    runtime.networkRequired !== false ||
    runtime.providerCredentialsRequired !== false ||
    runtime.physicalNeighbourhoodRequired !== true
  ) {
    throw new WorldPackLoadError("World Pack is not provider-independent physical media", "unsupported");
  }
  return {
    ...manifest,
    schemaVersion: 1,
    packId: string(manifest.packId, "manifest packId"),
    worldId: string(manifest.worldId, "manifest worldId"),
    routeId: string(manifest.routeId, "manifest routeId"),
    quality: string(manifest.quality, "manifest quality") as WorldPackManifest["quality"],
    artifacts,
    runtime: {
      entrypoint: path(runtime.entrypoint, "runtime entrypoint"),
      networkRequired: false,
      providerCredentialsRequired: false,
      physicalNeighbourhoodRequired: true,
    },
  };
}

function parseRuntime(value: unknown): WorldPackRuntime {
  const runtime = record(value, "World Pack runtime");
  if (runtime.schemaVersion !== 1 || runtime.coordinateReference !== "route-local-enu-v1") {
    throw new WorldPackLoadError("World Pack runtime version is unsupported", "unsupported");
  }
  const origin = record(runtime.origin, "World Pack origin");
  const assets = record(runtime.assets, "World Pack runtime assets");
  const physicalCapabilities =
    runtime.physicalCapabilities === undefined
      ? {
          terrainCollision: "heightfield",
          traversableSurfaces: "indexed-triangle-mesh",
          structuresCollision: "unavailable",
        }
      : record(
          runtime.physicalCapabilities,
          "World Pack physical capabilities",
        );
  const modes = Array.isArray(runtime.modes) ? runtime.modes : [];
  if (!modes.includes("guided") || !modes.includes("free-roam")) {
    throw new WorldPackLoadError("World Pack does not declare required traversal modes", "unsupported");
  }
  if (
    physicalCapabilities.terrainCollision !== "heightfield" ||
    physicalCapabilities.traversableSurfaces !== "indexed-triangle-mesh" ||
    physicalCapabilities.structuresCollision !== "unavailable"
  ) {
    throw new WorldPackLoadError(
      "World Pack declares unsupported physical capabilities",
      "unsupported",
    );
  }
  return {
    schemaVersion: 1,
    worldId: string(runtime.worldId, "runtime worldId"),
    routeId: string(runtime.routeId, "runtime routeId"),
    quality: string(runtime.quality, "runtime quality") as WorldPackRuntime["quality"],
    coordinateReference: "route-local-enu-v1",
    origin: {
      latitude: finite(origin.latitude, "origin latitude"),
      longitude: finite(origin.longitude, "origin longitude"),
      elevationM: finite(origin.elevationM, "origin elevation"),
    },
    explorationRadiusM: integer(runtime.explorationRadiusM, "exploration radius"),
    assets: {
      route: path(assets.route, "route asset"),
      terrain: path(assets.terrain, "terrain asset"),
      terrainCollision: path(assets.terrainCollision, "terrain collision asset"),
      ...(assets.terrainMask === undefined
        ? {}
        : { terrainMask: path(assets.terrainMask, "terrain mask asset") }),
      structuresCollision: path(assets.structuresCollision, "structures collision asset"),
      traversableSurfaces: path(assets.traversableSurfaces, "traversable surfaces asset"),
      navigation: path(assets.navigation, "navigation asset"),
      coverage: path(assets.coverage, "coverage asset"),
      cameraTimeline: path(assets.cameraTimeline, "camera timeline asset"),
    },
    physicalCapabilities: {
      terrainCollision: "heightfield",
      traversableSurfaces: "indexed-triangle-mesh",
      structuresCollision: "unavailable",
    },
    modes: modes as Array<"guided" | "free-roam">,
  };
}

function parseNavigation(value: unknown): WorldNavigation {
  const navigation = record(value, "World Pack navigation");
  const actor = record(navigation.actor, "World Pack actor");
  const nodes = Array.isArray(navigation.nodes) ? navigation.nodes : [];
  const edges = Array.isArray(navigation.edges) ? navigation.edges : [];
  const recoveryAnchors = Array.isArray(navigation.recoveryAnchors)
    ? navigation.recoveryAnchors.map((value) =>
        integer(value, "recovery anchor"),
      )
    : [];
  if (
    navigation.schemaVersion !== 1 ||
    navigation.coordinateReference !== "route-local-enu-v1" ||
    nodes.length < 2 ||
    edges.length < 1 ||
    recoveryAnchors.length < 2
  ) {
    throw new WorldPackLoadError(
      "World Pack navigation is incomplete",
      "invalid",
    );
  }
  const parsedNodes = nodes.map((value, index) => {
    const node = record(value, `navigation node ${index}`);
    if (!Array.isArray(node.position) || node.position.length !== 3) {
      throw new WorldPackLoadError(
        `navigation node ${index} position is invalid`,
        "invalid",
      );
    }
    return {
      id: integer(node.id, `navigation node ${index} id`),
      position: node.position.map((coordinate) =>
        finite(coordinate, `navigation node ${index} coordinate`),
      ) as [number, number, number],
      distanceM: finite(node.distanceM, `navigation node ${index} distance`),
      checkpoint: node.checkpoint === true,
      evidenceClass: "derived" as const,
    };
  });
  const parsedEdges = edges.map((value, index) => {
    const edge = record(value, `navigation edge ${index}`);
    return {
      from: integer(edge.from, `navigation edge ${index} from`),
      to: integer(edge.to, `navigation edge ${index} to`),
      lengthM: finite(edge.lengthM, `navigation edge ${index} length`),
      surface: "route-ribbon" as const,
      evidenceClass: "derived" as const,
    };
  });
  const fixedTimestepHz = integer(navigation.fixedTimestepHz, "fixed timestep");
  const radiusM = finite(actor.radiusM, "actor radius");
  const heightM = finite(actor.heightM, "actor height");
  const maximumStepM = finite(actor.maximumStepM, "actor maximum step");
  const maximumSlopeDegrees = finite(
    actor.maximumSlopeDegrees,
    "actor maximum slope",
  );
  const edgeKeys = parsedEdges.map((edge) => `${edge.from}:${edge.to}`);
  if (
    parsedNodes.some((node, index) => node.id !== index) ||
    parsedNodes.some(
      (node, index) =>
        node.distanceM < 0 ||
        (index > 0 && node.distanceM < parsedNodes[index - 1].distanceM),
    ) ||
    parsedEdges.some(
      (edge, index) =>
        edge.from < 0 ||
        edge.to !== edge.from + 1 ||
        edge.to >= parsedNodes.length ||
        edge.lengthM < 0 ||
        Math.abs(
          edge.lengthM -
            (parsedNodes[edge.to].distanceM - parsedNodes[edge.from].distanceM),
        ) > 1e-6 ||
        (index > 0 && edge.from <= parsedEdges[index - 1].from),
    ) ||
    new Set(edgeKeys).size !== edgeKeys.length ||
    fixedTimestepHz < 1 ||
    radiusM <= 0 ||
    heightM <= 0 ||
    maximumStepM < 0 ||
    maximumSlopeDegrees < 0 ||
    maximumSlopeDegrees > 90 ||
    recoveryAnchors.some((anchor) => anchor < 0 || anchor >= parsedNodes.length)
  ) {
    throw new WorldPackLoadError(
      "World Pack navigation graph is inconsistent",
      "invalid",
    );
  }
  return {
    schemaVersion: 1,
    coordinateReference: "route-local-enu-v1",
    fixedTimestepHz,
    actor: {
      radiusM,
      heightM,
      maximumStepM,
      maximumSlopeDegrees,
    },
    nodes: parsedNodes,
    edges: parsedEdges,
    recoveryAnchors,
  };
}

function parseCanonicalRoute(value: unknown): CanonicalWorldRoute {
  const route = record(value, "canonical World Pack route");
  if (route.schemaVersion !== 1 || !Array.isArray(route.coordinates) || route.coordinates.length < 2) {
    throw new WorldPackLoadError("canonical World Pack route is incomplete", "invalid");
  }
  const coordinates = route.coordinates.map((value, index) => {
    const coordinate = record(value, `canonical route coordinate ${index}`);
    return {
      latitude: finite(coordinate.latitude, `route coordinate ${index} latitude`),
      longitude: finite(coordinate.longitude, `route coordinate ${index} longitude`),
      elevationM: finite(coordinate.elevationM, `route coordinate ${index} elevation`),
      distanceM: finite(coordinate.distanceM, `route coordinate ${index} distance`),
      elapsedS:
        coordinate.elapsedS === null
          ? null
          : finite(coordinate.elapsedS, `route coordinate ${index} elapsed`),
    };
  });
  if (
    coordinates[0].distanceM !== 0 ||
    coordinates.some(
      (coordinate, index) =>
        index > 0 && coordinate.distanceM < coordinates[index - 1].distanceM,
    )
  ) {
    throw new WorldPackLoadError("canonical World Pack route distance is inconsistent", "invalid");
  }
  return {
    schemaVersion: 1,
    routeId: string(route.routeId, "canonical routeId"),
    slug: string(route.slug, "canonical route slug"),
    coordinates,
  };
}

async function verifyArtifact(artifact: WorldPackArtifact, bytes: Uint8Array) {
  if (bytes.byteLength !== artifact.byteSize) {
    throw new WorldPackLoadError(`World Pack size mismatch: ${artifact.logicalPath}`, "integrity");
  }
  if ((await sha256Hex(bytes)) !== artifact.sha256) {
    throw new WorldPackLoadError(`World Pack SHA-256 mismatch: ${artifact.logicalPath}`, "integrity");
  }
}

async function verifyPackIdentity(manifest: WorldPackManifest) {
  const { packId: _packId, runtime: _runtime, artifacts, ...identity } = manifest;
  const identityDocument = {
    ...identity,
    artifacts: artifacts.filter((artifact) => artifact.role !== "pack-binding"),
  };
  const expected = `wp_${await sha256Hex(canonicalJson(identityDocument))}`;
  if (manifest.packId !== expected) {
    throw new WorldPackLoadError("World Pack identity does not match its manifest", "integrity");
  }
}

export async function loadWorldPackForRoute(
  routeSlug: string,
  options: LoadOptions = {},
): Promise<VerifiedWorldPack> {
  const fetcher = options.fetcher ?? fetch;
  const applicationBase = new URL(options.baseHref ?? document.baseURI);
  const indexUrl = sameOriginUrl("/world-packs/index.json", applicationBase, "World Pack index");
  options.onPhase?.("index");
  const indexBytes = await fetchBytes(indexUrl, fetcher, options.signal);
  const entry = parseIndexEntry(parseJson(indexBytes, "World Pack index"), routeSlug);
  const baseUrl = sameOriginUrl(entry.basePath, applicationBase, "World Pack basePath");
  if (!baseUrl.pathname.endsWith(`/${entry.worldId}/${entry.packId}/`)) {
    throw new WorldPackLoadError("World Pack basePath does not bind its identity", "invalid");
  }

  options.onPhase?.("manifest");
  const [manifestBytes, checksumBytes] = await Promise.all([
    fetchBytes(sameOriginUrl("manifest.json", baseUrl, "manifest"), fetcher, options.signal),
    fetchBytes(sameOriginUrl("checksums.json", baseUrl, "checksums"), fetcher, options.signal),
  ]);
  if ((await sha256Hex(manifestBytes)) !== entry.manifestSha256) {
    throw new WorldPackLoadError("Published World Pack manifest hash does not match", "integrity");
  }
  const manifest = parseManifest(parseJson(manifestBytes, "World Pack manifest"));
  if (
    manifest.packId !== entry.packId ||
    manifest.worldId !== entry.worldId ||
    manifest.routeId !== routeSlug
  ) {
    throw new WorldPackLoadError("World Pack index and manifest identity disagree", "integrity");
  }
  await verifyPackIdentity(manifest);

  const checksums = record(parseJson(checksumBytes, "World Pack checksums"), "World Pack checksums");
  if (checksums.packId !== manifest.packId || !Array.isArray(checksums.files)) {
    throw new WorldPackLoadError("World Pack checksum ledger is not bound to this pack", "integrity");
  }
  const checksumEntries = new Map(
    checksums.files.map((value) => {
      const checksum = record(value, "checksum entry");
      const checksumPath = path(checksum.path, "checksum path");
      return [
        checksumPath,
        {
          sha256: string(checksum.sha256, `checksum sha256 for ${checksumPath}`),
          byteSize: integer(checksum.byteSize, `checksum byteSize for ${checksumPath}`),
        },
      ] as const;
    }),
  );
  const requiredArtifacts = manifest.artifacts.filter((artifact) => artifact.requiredRuntime);
  for (const artifact of requiredArtifacts) {
    const checksum = checksumEntries.get(artifact.logicalPath);
    if (!checksum) {
      throw new WorldPackLoadError(
        `Runtime artifact is absent from checksum ledger: ${artifact.logicalPath}`,
        "integrity",
      );
    }
    if (checksum.sha256 !== artifact.sha256 || checksum.byteSize !== artifact.byteSize) {
      throw new WorldPackLoadError(
        `Manifest and checksum ledger disagree: ${artifact.logicalPath}`,
        "integrity",
      );
    }
  }
  const totalBytes = requiredArtifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0);
  if (totalBytes > MAX_RUNTIME_BYTES) {
    throw new WorldPackLoadError("World Pack runtime exceeds the browser safety limit", "too-large");
  }

  options.onPhase?.("integrity");
  const artifactEntries = await Promise.all(
    requiredArtifacts.map(async (artifact) => {
      const bytes = await fetchBytes(
        sameOriginUrl(artifact.logicalPath, baseUrl, "artifact"),
        fetcher,
        options.signal,
      );
      await verifyArtifact(artifact, bytes);
      return [artifact.logicalPath, bytes] as const;
    }),
  );
  const artifacts = new Map(artifactEntries);
  const runtimeBytes = artifacts.get(manifest.runtime.entrypoint);
  if (!runtimeBytes) {
    throw new WorldPackLoadError("World Pack runtime entrypoint was not verified", "integrity");
  }
  const runtime = parseRuntime(parseJson(runtimeBytes, "World Pack runtime"));
  if (runtime.worldId !== manifest.worldId || runtime.routeId !== manifest.routeId) {
    throw new WorldPackLoadError("World Pack runtime identity disagrees with its manifest", "integrity");
  }
  for (const runtimePath of Object.values(runtime.assets)) {
    if (!artifacts.has(runtimePath)) {
      throw new WorldPackLoadError(`Runtime asset was not verified: ${runtimePath}`, "integrity");
    }
  }
  const canonicalPath = manifest.artifacts.find((artifact) => artifact.role === "canonical-route")?.logicalPath;
  if (!canonicalPath || !artifacts.has(canonicalPath)) {
    throw new WorldPackLoadError("World Pack canonical route was not verified", "integrity");
  }

  options.onPhase?.("physical-neighbourhood");
  const navigation = parseNavigation(
    parseJson(artifacts.get(runtime.assets.navigation)!, "World Pack navigation"),
  );
  const canonicalRoute = parseCanonicalRoute(
    parseJson(artifacts.get(canonicalPath)!, "canonical World Pack route"),
  );
  if (canonicalRoute.routeId !== manifest.routeId || navigation.nodes.length < 2) {
    throw new WorldPackLoadError("World Pack physical route identity is inconsistent", "integrity");
  }

  options.onPhase?.("ready");
  return {
    entry,
    baseUrl,
    manifest,
    runtime,
    navigation,
    canonicalRoute,
    artifacts,
    artifact(logicalPath: string) {
      const bytes = artifacts.get(logicalPath);
      if (!bytes) throw new WorldPackLoadError(`Artifact is not verified: ${logicalPath}`, "integrity");
      return bytes;
    },
    artifactUrl(logicalPath: string) {
      if (!artifacts.has(logicalPath)) {
        throw new WorldPackLoadError(`Artifact is not verified: ${logicalPath}`, "integrity");
      }
      return sameOriginUrl(logicalPath, baseUrl, "artifact");
    },
  };
}
