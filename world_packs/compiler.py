"""Failure-atomic deterministic compilation of route-scoped Core World Packs."""

from __future__ import annotations

import math
import os
import shutil
import tempfile
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from .canonical import canonical_json_bytes, canonical_json_document, sha256_file
from .errors import IntegrityError, ValidationError
from .geometry import (
    LocalPoint,
    empty_glb,
    route_local_points,
    route_ribbon_glb,
    route_thread_glb,
    terrain_glb,
)
from .route import load_canonical_route
from .schema import validate_document
from .storage import ContentAddressedStore, ObjectRecord
from .transformations import TransformationGraph, TransformationStep


COMPILER_NAME = "godiesel-world-compiler"
COMPILER_VERSION = "0.1.0"
COORDINATE_REFERENCE = "route-local-enu-v1"


@dataclass(frozen=True)
class BuildConfiguration:
    world_id: str
    acquired_at: str
    quality: str = "core"
    corridor_radius_m: int = 1_000
    exploration_radius_m: int = 1_600
    quality_cell_size_m: int = 250
    source_uri: str = "repository:strict-route-detail"
    source_date: str | None = None
    licence: str = "owner-controlled-derived-route-data"
    attribution: str = "goDiesel route pipeline"
    deliberate_missing_cell_offsets: tuple[tuple[int, int], ...] = ()

    def __post_init__(self) -> None:
        if not self.world_id or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789-"
            for character in self.world_id
        ):
            raise ValidationError("world_id must be lowercase kebab case")
        if self.quality != "core":
            raise ValidationError(
                "the foundation compiler admits only Core inputs; Detailed and Archival require explicit source adapters"
            )
        if self.corridor_radius_m < 1 or self.exploration_radius_m < 1:
            raise ValidationError("world radii must be positive")
        if self.exploration_radius_m < self.corridor_radius_m:
            raise ValidationError("exploration radius cannot be smaller than corridor radius")
        if self.quality_cell_size_m < 1:
            raise ValidationError("quality cell size must be positive")

    def manifest_configuration(self) -> dict[str, object]:
        return {
            "corridorRadiusM": self.corridor_radius_m,
            "explorationRadiusM": self.exploration_radius_m,
            "qualityCellSizeM": self.quality_cell_size_m,
            "coordinateReference": COORDINATE_REFERENCE,
            "deliberateMissingCellOffsets": [
                list(offset) for offset in self.deliberate_missing_cell_offsets
            ],
        }


@dataclass(frozen=True)
class ArtifactRecord:
    logicalPath: str
    kind: str
    role: str
    sha256: str
    byteSize: int
    mediaType: str
    formatVersion: str
    evidenceClass: str
    requiredRuntime: bool
    transformationIds: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["transformationIds"] = list(self.transformationIds)
        return value


@dataclass(frozen=True)
class BuildResult:
    world_id: str
    pack_id: str
    path: Path
    created: bool


class _PackAssembler:
    def __init__(
        self,
        staging: Path,
        store: ContentAddressedStore,
        source_digest: str,
    ) -> None:
        self.staging = staging
        self.store = store
        self.source_digest = source_digest
        self.artifacts: list[ArtifactRecord] = []
        self.transformations = TransformationGraph()

    def add(
        self,
        logical_path: str,
        value: bytes,
        *,
        media_type: str,
        format_version: str,
        evidence_class: str,
        role: str,
        required_runtime: bool,
        kind: str = "artifact",
        transform_name: str | None = None,
        transform_inputs: tuple[str, ...] | None = None,
    ) -> ArtifactRecord:
        if any(record.logicalPath == logical_path for record in self.artifacts):
            raise IntegrityError(f"duplicate pack artifact path: {logical_path}")
        object_record = self.store.admit(
            value, media_type=media_type, format_version=format_version
        )
        transformation_ids: tuple[str, ...] = ()
        if transform_name is not None:
            step = TransformationStep(
                name=transform_name,
                version=COMPILER_VERSION,
                inputs=transform_inputs or (self.source_digest,),
                outputs=(object_record.sha256,),
                configuration={"logicalPath": logical_path},
            )
            transformation_ids = (self.transformations.add(step),)
        self.store.materialize(object_record, self.staging / logical_path)
        record = ArtifactRecord(
            logicalPath=logical_path,
            kind=kind,
            role=role,
            sha256=object_record.sha256,
            byteSize=object_record.byteSize,
            mediaType=object_record.mediaType,
            formatVersion=object_record.formatVersion,
            evidenceClass=evidence_class,
            requiredRuntime=required_runtime,
            transformationIds=transformation_ids,
        )
        self.artifacts.append(record)
        return record

    def add_json(
        self,
        logical_path: str,
        value: object,
        **properties: object,
    ) -> ArtifactRecord:
        return self.add(
            logical_path,
            canonical_json_document(value),
            media_type="application/json",
            **properties,
        )


def _evidence(
    evidence_class: str,
    source_sha256: str | None,
    reason: str,
) -> dict[str, object]:
    return {
        "class": evidence_class,
        "sourceSha256": source_sha256,
        "reason": reason,
    }


def _coverage_document(
    points: list[LocalPoint],
    configuration: BuildConfiguration,
    source_sha256: str,
) -> dict[str, object]:
    size = configuration.quality_cell_size_m
    radius = configuration.exploration_radius_m
    minimum_x = math.floor((min(point.x for point in points) - radius) / size)
    maximum_x = math.ceil((max(point.x for point in points) + radius) / size)
    minimum_y = math.floor((min(point.y for point in points) - radius) / size)
    maximum_y = math.ceil((max(point.y for point in points) + radius) / size)
    deliberate = set(configuration.deliberate_missing_cell_offsets)
    cells = []
    for y_index in range(minimum_y, maximum_y + 1):
        for x_index in range(minimum_x, maximum_x + 1):
            center_x = (x_index + 0.5) * size
            center_y = (y_index + 0.5) * size
            nearest_squared = min(
                (point.x - center_x) ** 2 + (point.y - center_y) ** 2
                for point in points
            )
            if nearest_squared > radius**2:
                continue
            deliberate_gap = (x_index, y_index) in deliberate
            visual_reason = (
                "Deliberate source-gap fixture completed with deterministic procedural material"
                if deliberate_gap
                else "No retainable imagery source admitted in Core v1; deterministic procedural material used"
            )
            cells.append(
                {
                    "id": f"{x_index}:{y_index}",
                    "eastingM": x_index * size,
                    "northingM": y_index * size,
                    "terrain": _evidence(
                        "procedural",
                        source_sha256,
                        "Terrain shape is procedurally interpolated from recorded route elevations",
                    ),
                    "visual": _evidence("procedural", None, visual_reason),
                    "structures": _evidence(
                        "unavailable",
                        None,
                        "No retainable structure source has been admitted",
                    ),
                    "collision": _evidence(
                        "procedural",
                        source_sha256,
                        "Stable collision is compiled separately from the procedural terrain",
                    ),
                    "acquisitionDate": configuration.acquired_at,
                    "sourceDate": configuration.source_date,
                    "transformationVersion": COMPILER_VERSION,
                    "accuracyM": None,
                    "confidence": 0.25 if deliberate_gap else 0.4,
                    "visualQuality": "core",
                    "physicsQuality": "core",
                    "deliberateGap": deliberate_gap,
                }
            )
    document = {
        "schemaVersion": 1,
        "cellSizeM": size,
        "coordinateReference": COORDINATE_REFERENCE,
        "cells": cells,
    }
    validate_document("coverage", document)
    return document


def _navigation_document(points: list[LocalPoint]) -> dict[str, object]:
    final_index = len(points) - 1
    checkpoints = {0, final_index // 2, final_index}
    nodes = [
        {
            "id": index,
            "position": [point.x, point.y, point.z],
            "distanceM": point.distance_m,
            "checkpoint": index in checkpoints,
            "evidenceClass": "derived",
        }
        for index, point in enumerate(points)
    ]
    edges = [
        {
            "from": index,
            "to": index + 1,
            "lengthM": max(0.0, points[index + 1].distance_m - point.distance_m),
            "surface": "route-ribbon",
            "evidenceClass": "derived",
        }
        for index, point in enumerate(points[:-1])
    ]
    document = {
        "schemaVersion": 1,
        "coordinateReference": COORDINATE_REFERENCE,
        "fixedTimestepHz": 60,
        "actor": {
            "radiusM": 0.35,
            "heightM": 1.75,
            "maximumStepM": 0.35,
            "maximumSlopeDegrees": 35,
        },
        "nodes": nodes,
        "edges": edges,
        "recoveryAnchors": sorted(checkpoints),
    }
    validate_document("world-navigation", document)
    return document


def _camera_document(points: list[LocalPoint]) -> dict[str, object]:
    duration_frames = 45 * 30
    sample_count = min(24, len(points))
    indices = sorted(
        {
            round(sample_index * (len(points) - 1) / (sample_count - 1))
            for sample_index in range(sample_count)
        }
    )
    keyframes = []
    for keyframe_index, point_index in enumerate(indices):
        point = points[point_index]
        before = points[max(0, point_index - 1)]
        after = points[min(len(points) - 1, point_index + 1)]
        dx = after.x - before.x
        dy = after.y - before.y
        magnitude = math.hypot(dx, dy) or 1.0
        keyframes.append(
            {
                "frame": round(
                    keyframe_index * (duration_frames - 1) / (len(indices) - 1)
                ),
                "routePointIndex": point_index,
                "camera": [
                    point.x - dx / magnitude * 24,
                    point.y - dy / magnitude * 24,
                    point.z + 12,
                ],
                "target": [point.x, point.y, point.z + 1.5],
            }
        )
    document = {
        "schemaVersion": 1,
        "timelineId": "route-teaser-45s-v1",
        "durationFrames": duration_frames,
        "framesPerSecond": 30,
        "evidenceClass": "derived",
        "keyframes": keyframes,
    }
    validate_document("camera-timelines", document)
    return document


class WorldPackCompiler:
    def __init__(self, repository: Path):
        self.repository = repository.resolve()
        self.store = ContentAddressedStore(self.repository / "objects")
        self.packs = self.repository / "packs"
        self.staging_root = self.repository / ".staging"

    def build_route(
        self, route_detail_path: Path, configuration: BuildConfiguration
    ) -> BuildResult:
        if not route_detail_path.is_file() or route_detail_path.is_symlink():
            raise ValidationError(
                f"route detail is not a regular source file: {route_detail_path}"
            )
        canonical_route = load_canonical_route(route_detail_path)
        route_id = str(canonical_route["routeId"])
        source_bytes = route_detail_path.read_bytes()
        source_record = self.store.admit(
            source_bytes,
            media_type="application/json",
            format_version="godiesel-strict-route-detail-v1",
        )
        self.staging_root.mkdir(parents=True, exist_ok=True)
        staging = self.staging_root / f"{configuration.world_id}.{uuid.uuid4().hex}"
        staging.mkdir()
        try:
            assembler = _PackAssembler(staging, self.store, source_record.sha256)
            source_artifact = assembler.add(
                "sources/original/route-detail.json",
                source_bytes,
                media_type="application/json",
                format_version="godiesel-strict-route-detail-v1",
                evidence_class="derived",
                role="strict-route-detail",
                required_runtime=False,
                kind="source",
            )
            source_inventory = {
                "schemaVersion": 1,
                "sources": [
                    {
                        "logicalName": "strict-route-detail",
                        "logicalPath": source_artifact.logicalPath,
                        "sha256": source_artifact.sha256,
                        "byteSize": source_artifact.byteSize,
                        "mediaType": source_artifact.mediaType,
                        "formatVersion": source_artifact.formatVersion,
                        "evidenceClass": source_artifact.evidenceClass,
                        "sourceUri": configuration.source_uri,
                        "acquiredAt": configuration.acquired_at,
                        "sourceDate": configuration.source_date,
                        "licence": configuration.licence,
                        "attribution": configuration.attribution,
                        "adapter": "strict-route-detail",
                        "adapterVersion": "1",
                    }
                ],
            }
            validate_document("source-inventory", source_inventory)
            inventory_record = assembler.add_json(
                "sources/inventory.json",
                source_inventory,
                format_version="1",
                evidence_class="derived",
                role="source-inventory",
                required_runtime=False,
                transform_name="assemble-source-inventory",
            )
            points = route_local_points(canonical_route)
            route_record = assembler.add_json(
                "route/canonical-route.json",
                canonical_route,
                format_version="1",
                evidence_class="derived",
                role="canonical-route",
                required_runtime=True,
                transform_name="normalize-route-detail",
            )
            assembler.add_json(
                "route/annotations.json",
                {"schemaVersion": 1, "items": []},
                format_version="1",
                evidence_class="unavailable",
                role="route-annotations",
                required_runtime=False,
                transform_name="index-route-annotations",
            )
            assembler.add_json(
                "route/media-index.json",
                {"schemaVersion": 1, "items": []},
                format_version="1",
                evidence_class="unavailable",
                role="route-media-index",
                required_runtime=False,
                transform_name="index-route-media",
            )
            route_thread = assembler.add(
                "route/route-thread.glb",
                route_thread_glb(points),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="derived",
                role="route-thread",
                required_runtime=True,
                transform_name="compile-route-thread-glb",
            )
            terrain_visual = assembler.add(
                "terrain/surface/core-terrain.glb",
                terrain_glb(
                    points,
                    exploration_radius_m=configuration.exploration_radius_m,
                    cell_size_m=configuration.quality_cell_size_m,
                    name="Procedural visual terrain",
                ),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="procedural",
                role="visual-terrain",
                required_runtime=True,
                transform_name="compile-procedural-visual-terrain",
            )
            terrain_collision = assembler.add(
                "physics/terrain-collision.glb",
                terrain_glb(
                    points,
                    exploration_radius_m=configuration.exploration_radius_m,
                    cell_size_m=configuration.quality_cell_size_m,
                    name="Stable terrain collision",
                ),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="procedural",
                role="terrain-collision",
                required_runtime=True,
                transform_name="compile-stable-terrain-collision",
            )
            structures_collision = assembler.add(
                "physics/structures-collision.glb",
                empty_glb("No admitted structures"),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="unavailable",
                role="structures-collision",
                required_runtime=True,
                transform_name="compile-empty-structures-collision",
            )
            traversable = assembler.add(
                "physics/traversable-surfaces.glb",
                route_ribbon_glb(points),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="procedural",
                role="traversable-surfaces",
                required_runtime=True,
                transform_name="compile-route-traversable-surface",
            )
            navigation = _navigation_document(points)
            navigation_record = assembler.add_json(
                "physics/world-navigation.json",
                navigation,
                format_version="1",
                evidence_class="derived",
                role="world-navigation",
                required_runtime=True,
                transform_name="compile-route-navigation",
            )
            assembler.add_json(
                "transportation/network.json",
                {
                    "schemaVersion": 1,
                    "roads": {"class": "unavailable", "features": []},
                    "paths": {"class": "unavailable", "features": []},
                    "trails": {"class": "unavailable", "features": []},
                },
                format_version="1",
                evidence_class="unavailable",
                role="transportation-network",
                required_runtime=False,
                transform_name="declare-unavailable-transportation",
            )
            assembler.add_json(
                "structures/tileset.json",
                {"schemaVersion": 1, "class": "unavailable", "contents": []},
                format_version="1",
                evidence_class="unavailable",
                role="structure-tileset",
                required_runtime=False,
                transform_name="declare-unavailable-structures",
            )
            assembler.add_json(
                "imagery/materials/procedural.json",
                {
                    "schemaVersion": 1,
                    "class": "procedural",
                    "palette": {
                        "terrain": "#6b7756",
                        "route": "#ff5e45",
                        "water": "#446e7a",
                    },
                },
                format_version="1",
                evidence_class="procedural",
                role="procedural-materials",
                required_runtime=True,
                transform_name="compile-procedural-materials",
            )
            assembler.add_json(
                "lod/core.json",
                {
                    "schemaVersion": 1,
                    "global": terrain_visual.logicalPath,
                    "regional": terrain_visual.logicalPath,
                    "playerBubble": terrain_visual.logicalPath,
                    "policy": "single-core-mesh-v1",
                },
                format_version="1",
                evidence_class="procedural",
                role="lod-policy",
                required_runtime=True,
                transform_name="compile-core-lod-policy",
            )
            coverage = _coverage_document(
                points, configuration, source_record.sha256
            )
            coverage_record = assembler.add_json(
                "provenance/coverage.json",
                coverage,
                format_version="1",
                evidence_class="derived",
                role="coverage",
                required_runtime=True,
                transform_name="compile-quality-cell-coverage",
            )
            assembler.add_json(
                "provenance/accuracy.json",
                {
                    "schemaVersion": 1,
                    "route": {"class": "derived", "declaredAccuracyM": None},
                    "terrain": {"class": "procedural", "declaredAccuracyM": None},
                    "collision": {"class": "procedural", "declaredAccuracyM": None},
                },
                format_version="1",
                evidence_class="derived",
                role="accuracy",
                required_runtime=False,
                transform_name="declare-accuracy",
            )
            assembler.add_json(
                "provenance/attribution.json",
                {
                    "schemaVersion": 1,
                    "entries": [
                        {
                            "scope": source_artifact.logicalPath,
                            "licence": configuration.licence,
                            "attribution": configuration.attribution,
                        },
                        {
                            "scope": "procedural-core",
                            "licence": "goDiesel-generated-artifact",
                            "attribution": "goDiesel World Compiler",
                        },
                    ],
                },
                format_version="1",
                evidence_class="derived",
                role="attribution",
                required_runtime=True,
                transform_name="assemble-attribution",
            )
            camera = _camera_document(points)
            camera_record = assembler.add_json(
                "cinematic/camera-timelines.json",
                camera,
                format_version="1",
                evidence_class="derived",
                role="camera-timeline",
                required_runtime=True,
                transform_name="compile-deterministic-camera-timeline",
            )
            assembler.add_json(
                "cinematic/poster-candidates.json",
                {
                    "schemaVersion": 1,
                    "routePointIndices": [0, len(points) // 2, len(points) - 1],
                    "evidenceClass": "derived",
                },
                format_version="1",
                evidence_class="derived",
                role="poster-candidates",
                required_runtime=False,
                transform_name="select-poster-candidates",
            )
            assembler.add_json(
                "reconstruction/inventory.json",
                {
                    "schemaVersion": 1,
                    "status": "unavailable",
                    "sources": [],
                },
                format_version="1",
                evidence_class="unavailable",
                role="reconstruction-inventory",
                required_runtime=False,
                transform_name="declare-unavailable-reconstruction",
            )
            first_coordinate = canonical_route["coordinates"][0]
            assert isinstance(first_coordinate, dict)
            runtime = {
                "schemaVersion": 1,
                "worldId": configuration.world_id,
                "routeId": route_id,
                "quality": configuration.quality,
                "coordinateReference": COORDINATE_REFERENCE,
                "origin": {
                    "latitude": first_coordinate["latitude"],
                    "longitude": first_coordinate["longitude"],
                    "elevationM": first_coordinate["elevationM"],
                },
                "explorationRadiusM": configuration.exploration_radius_m,
                "assets": {
                    "route": route_thread.logicalPath,
                    "terrain": terrain_visual.logicalPath,
                    "terrainCollision": terrain_collision.logicalPath,
                    "structuresCollision": structures_collision.logicalPath,
                    "traversableSurfaces": traversable.logicalPath,
                    "navigation": navigation_record.logicalPath,
                    "coverage": coverage_record.logicalPath,
                    "cameraTimeline": camera_record.logicalPath,
                },
                "modes": ["guided", "free-roam"],
            }
            validate_document("runtime-world", runtime)
            assembler.add_json(
                "runtime/world.json",
                runtime,
                format_version="1",
                evidence_class="derived",
                role="runtime-entrypoint",
                required_runtime=True,
                transform_name="assemble-runtime-world",
                transform_inputs=(
                    route_record.sha256,
                    terrain_visual.sha256,
                    terrain_collision.sha256,
                    navigation_record.sha256,
                    coverage_record.sha256,
                    camera_record.sha256,
                ),
            )
            assembler.add_json(
                "migrations/version.json",
                {
                    "schemaVersion": 1,
                    "minimumReaderVersion": "0.1.0",
                    "createdByVersion": COMPILER_VERSION,
                    "migratedFrom": None,
                },
                format_version="1",
                evidence_class="derived",
                role="migration-version",
                required_runtime=False,
                transform_name="declare-pack-version",
            )
            transformation_document = assembler.transformations.as_document()
            validate_document("transformations", transformation_document)
            transformation_record = assembler.add_json(
                "provenance/transformations.json",
                transformation_document,
                format_version="1",
                evidence_class="derived",
                role="transformation-graph",
                required_runtime=False,
            )
            identity_artifacts = sorted(
                (record.as_dict() for record in assembler.artifacts),
                key=lambda record: str(record["logicalPath"]),
            )
            identity = {
                "schemaVersion": 1,
                "worldId": configuration.world_id,
                "routeId": route_id,
                "quality": configuration.quality,
                "compiler": {"name": COMPILER_NAME, "version": COMPILER_VERSION},
                "configuration": configuration.manifest_configuration(),
                "sourceInventorySha256": inventory_record.sha256,
                "transformationGraphSha256": transformation_record.sha256,
                "coverageSha256": coverage_record.sha256,
                "artifacts": identity_artifacts,
            }
            pack_id = f"wp_{self._identity_digest(identity)}"
            experience = {
                "schemaVersion": 1,
                "packId": pack_id,
                "worldId": configuration.world_id,
                "routeId": route_id,
                "quality": configuration.quality,
                "cameraTimelinePath": camera_record.logicalPath,
                "cameraTimelineSha256": camera_record.sha256,
                "geometrySha256": terrain_visual.sha256,
                "selectedMoments": [],
                "media": [],
            }
            validate_document("experience-manifest", experience)
            assembler.add_json(
                "cinematic/experience-manifest.json",
                experience,
                format_version="1",
                evidence_class="derived",
                role="pack-binding",
                required_runtime=True,
            )
            manifest = {
                **identity,
                "packId": pack_id,
                "artifacts": sorted(
                    (record.as_dict() for record in assembler.artifacts),
                    key=lambda record: str(record["logicalPath"]),
                ),
                "runtime": {
                    "entrypoint": "runtime/world.json",
                    "networkRequired": False,
                    "providerCredentialsRequired": False,
                    "physicalNeighbourhoodRequired": True,
                },
            }
            validate_document("manifest", manifest)
            manifest_value = canonical_json_document(manifest)
            manifest_object = self.store.admit(
                manifest_value,
                media_type="application/json",
                format_version="1",
            )
            self.store.materialize(manifest_object, staging / "manifest.json")
            checksums = self._checksums(staging, pack_id)
            validate_document("checksums", checksums)
            checksums_object = self.store.admit(
                canonical_json_document(checksums),
                media_type="application/json",
                format_version="1",
            )
            self.store.materialize(checksums_object, staging / "checksums.json")
            return self._promote(staging, configuration.world_id, pack_id)
        except Exception:
            if staging.exists():
                self._make_writable(staging)
                shutil.rmtree(staging)
            raise

    @staticmethod
    def _identity_digest(identity: dict[str, object]) -> str:
        from .canonical import sha256_bytes

        return sha256_bytes(canonical_json_bytes(identity))

    @staticmethod
    def _checksums(staging: Path, pack_id: str) -> dict[str, object]:
        files = []
        for path in sorted(staging.rglob("*")):
            if not path.is_file() or path.name == "checksums.json":
                continue
            files.append(
                {
                    "path": path.relative_to(staging).as_posix(),
                    "sha256": sha256_file(path),
                    "byteSize": path.stat().st_size,
                }
            )
        return {
            "schemaVersion": 1,
            "packId": pack_id,
            "algorithm": "sha256",
            "files": files,
        }

    @staticmethod
    def _seal(path: Path) -> None:
        for child in path.rglob("*"):
            if child.is_file():
                child.chmod(0o444)
        for child in sorted(
            (candidate for candidate in path.rglob("*") if candidate.is_dir()),
            key=lambda candidate: len(candidate.parts),
            reverse=True,
        ):
            child.chmod(0o555)
        path.chmod(0o555)

    @staticmethod
    def _make_writable(path: Path) -> None:
        path.chmod(0o755)
        for child in path.rglob("*"):
            if child.is_dir():
                child.chmod(0o755)
            elif child.is_file():
                child.chmod(0o644)

    def _promote(self, staging: Path, world_id: str, pack_id: str) -> BuildResult:
        world_root = self.packs / world_id
        world_root.mkdir(parents=True, exist_ok=True)
        final = world_root / pack_id
        created = False
        if final.exists():
            if not (final / "checksums.json").is_file():
                raise IntegrityError(
                    f"conflicting pack directory has no checksum inventory: {final}"
                )
            if (final / "checksums.json").read_bytes() != (
                staging / "checksums.json"
            ).read_bytes():
                raise IntegrityError(
                    f"sealed pack identity collision at {final}"
                )
            self._make_writable(staging)
            shutil.rmtree(staging)
        else:
            os.replace(staging, final)
            self._seal(final)
            created = True
        current = canonical_json_document(
            {"schemaVersion": 1, "packId": pack_id, "path": pack_id}
        )
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".current.", dir=world_root
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(current)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, world_root / "current.json")
        finally:
            temporary.unlink(missing_ok=True)
        return BuildResult(world_id, pack_id, final, created)
