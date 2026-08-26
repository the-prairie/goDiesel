export interface WorldPackIndexEntry {
  worldId: string;
  packId: string;
  basePath: string;
  manifestSha256: string;
}

export interface WorldPackArtifact {
  logicalPath: string;
  kind: "source" | "artifact";
  role: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  formatVersion: string;
  evidenceClass:
    | "recorded"
    | "derived"
    | "measured"
    | "reconstructed"
    | "procedural"
    | "unavailable";
  requiredRuntime: boolean;
  transformationIds: string[];
}

export interface WorldPackManifest {
  schemaVersion: 1;
  packId: string;
  worldId: string;
  routeId: string;
  quality: "core" | "detailed" | "archival";
  artifacts: WorldPackArtifact[];
  runtime: {
    entrypoint: string;
    networkRequired: false;
    providerCredentialsRequired: false;
    physicalNeighbourhoodRequired: true;
  };
  [key: string]: unknown;
}

export interface WorldPackRuntime {
  schemaVersion: 1;
  worldId: string;
  routeId: string;
  quality: "core" | "detailed" | "archival";
  coordinateReference: "route-local-enu-v1";
  origin: {
    latitude: number;
    longitude: number;
    elevationM: number;
  };
  explorationRadiusM: number;
  assets: {
    route: string;
    terrain: string;
    terrainCollision: string;
    terrainMask?: string;
    structureTilesets?: Array<{
      path: string;
      verticalAlignmentOffsetM: number;
    }>;
    structuresCollision: string;
    traversableSurfaces: string;
    navigation: string;
    coverage: string;
    cameraTimeline: string;
  };
  physicalCapabilities: {
    terrainCollision: "heightfield";
    traversableSurfaces: "indexed-triangle-mesh";
    structuresCollision: "unavailable";
  };
  modes: Array<"guided" | "free-roam">;
}

export interface WorldNavigationNode {
  id: number;
  position: [number, number, number];
  distanceM: number;
  checkpoint: boolean;
  evidenceClass: "derived";
}

export interface WorldNavigation {
  schemaVersion: 1;
  coordinateReference: "route-local-enu-v1";
  fixedTimestepHz: number;
  actor: {
    radiusM: number;
    heightM: number;
    maximumStepM: number;
    maximumSlopeDegrees: number;
  };
  nodes: WorldNavigationNode[];
  edges: Array<{
    from: number;
    to: number;
    lengthM: number;
    surface: "route-ribbon";
    evidenceClass: "derived";
  }>;
  recoveryAnchors: number[];
}

export interface CanonicalWorldRoute {
  schemaVersion: 1;
  routeId: string;
  slug: string;
  coordinates: Array<{
    latitude: number;
    longitude: number;
    elevationM: number;
    distanceM: number;
    elapsedS: number | null;
  }>;
}

export interface VerifiedWorldPack {
  entry: WorldPackIndexEntry;
  baseUrl: URL;
  manifest: WorldPackManifest;
  runtime: WorldPackRuntime;
  navigation: WorldNavigation;
  canonicalRoute: CanonicalWorldRoute;
  artifacts: ReadonlyMap<string, Uint8Array>;
  artifact(path: string): Uint8Array;
  artifactUrl(path: string): URL;
}

export type WorldPackLoadPhase =
  | "index"
  | "manifest"
  | "integrity"
  | "physical-neighbourhood"
  | "ready";
