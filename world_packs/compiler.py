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
from .osm import OsmWorldData
from .route import load_canonical_route
from .schema import validate_document
from .storage import ContentAddressedStore, ObjectRecord
from .structures import StructureTileset
from .terrain import NormalizedTerrain
from .transformations import TransformationGraph, TransformationStep


COMPILER_NAME = "godiesel-world-compiler"
COMPILER_VERSION = "0.2.0"
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
    normalized_terrain_path: Path | None = None
    structure_tileset_paths: tuple[Path, ...] = ()
    structure_licence: str | None = None
    structure_attribution: str | None = None
    osm_network_path: Path | None = None
    osm_network_paths: tuple[Path, ...] = ()
    osm_source_uri: str | None = None
    osm_source_uris: tuple[str, ...] = ()
    osm_licence: str | None = None
    osm_attribution: str | None = None

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
        if self.structure_tileset_paths and (
            not self.structure_licence or not self.structure_attribution
        ):
            raise ValidationError(
                "structure tilesets require explicit licence and attribution"
            )
        if self.osm_network_path is not None and self.osm_network_paths:
            raise ValidationError("declare one OSM path or OSM source shards, not both")
        osm_paths = (
            (self.osm_network_path,)
            if self.osm_network_path is not None
            else self.osm_network_paths
        )
        osm_uris = (
            (self.osm_source_uri,)
            if self.osm_network_path is not None
            else self.osm_source_uris
        )
        if osm_paths and (
            len(osm_paths) != len(osm_uris)
            or any(not uri for uri in osm_uris)
            or not self.osm_licence
            or not self.osm_attribution
        ):
            raise ValidationError(
                "every OSM input requires an exact source URI, licence, and attribution"
            )

    def manifest_configuration(self) -> dict[str, object]:
        return {
            "corridorRadiusM": self.corridor_radius_m,
            "explorationRadiusM": self.exploration_radius_m,
            "qualityCellSizeM": self.quality_cell_size_m,
            "coordinateReference": COORDINATE_REFERENCE,
            "deliberateMissingCellOffsets": [
                list(offset) for offset in self.deliberate_missing_cell_offsets
            ],
            "terrainInput": (
                "normalized-measured-v1"
                if self.normalized_terrain_path is not None
                else "procedural-route-v1"
            ),
            **(
                {"structureInput": "plateau-lod1-subset-v1"}
                if self.structure_tileset_paths
                else {}
            ),
            **(
                {"transportationInput": "osm-overpass-json-v1"}
                if self.osm_network_path is not None or self.osm_network_paths
                else {}
            ),
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
    terrain: NormalizedTerrain | None = None,
    structure_tilesets: tuple[StructureTileset, ...] = (),
    osm_world: OsmWorldData | None = None,
    *,
    origin_latitude: float,
    origin_longitude: float,
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
            measured_terrain = terrain is not None and terrain.is_measured_at(
                center_x, center_y
            )
            structure_source = next(
                (
                    tileset.source_manifest_sha256
                    for tileset in structure_tilesets
                    if tileset.covers_local_point(
                        center_x,
                        center_y,
                        origin_latitude,
                        origin_longitude,
                    )
                ),
                None,
            )
            osm_structure_source = (
                osm_world.sha256
                if osm_world is not None
                and any(
                    x_index * size <= x < (x_index + 1) * size
                    and y_index * size <= y < (y_index + 1) * size
                    for building in osm_world.buildings
                    for x, y in building.footprint
                )
                else None
            )
            declared_structure_source = structure_source or osm_structure_source
            terrain_source_sha256 = (
                str(terrain.document["source"]["sha256"])
                if terrain is not None
                else source_sha256
            )
            visual_reason = (
                "Deliberate source-gap fixture completed with deterministic procedural material"
                if deliberate_gap
                else "Measured elevation is rendered with deterministic local material"
                if measured_terrain
                else "Raster no-data is represented by declared sea-level fill"
                if terrain is not None
                else "No retainable imagery source admitted in Core v1; deterministic procedural material used"
            )
            cells.append(
                {
                    "id": f"{x_index}:{y_index}",
                    "eastingM": x_index * size,
                    "northingM": y_index * size,
                    "terrain": _evidence(
                        "measured" if measured_terrain else "derived" if terrain else "procedural",
                        terrain_source_sha256,
                        "Elevation is sampled from the admitted normalized terrain grid"
                        if measured_terrain
                        else "Raster no-data is filled at declared aligned sea level"
                        if terrain
                        else "Terrain shape is procedurally interpolated from recorded route elevations",
                    ),
                    "visual": _evidence(
                        "derived" if terrain else "procedural",
                        terrain_source_sha256 if terrain else None,
                        visual_reason,
                    ),
                    "structures": _evidence(
                        "derived"
                        if declared_structure_source is not None
                        else "unavailable",
                        declared_structure_source,
                        "Retained official PLATEAU LOD1 geometry covers this quality cell"
                        if structure_source is not None
                        else "Recorded OSM building footprints cover this quality cell"
                        if osm_structure_source is not None
                        else "No retainable structure source has been admitted"
                        if not structure_tilesets and osm_world is None
                        else "No retained structure evidence covers this quality cell",
                    ),
                    "collision": _evidence(
                        "derived"
                        if osm_structure_source is not None
                        else "measured"
                        if measured_terrain
                        else "unavailable"
                        if terrain
                        else "procedural",
                        osm_structure_source
                        if osm_structure_source is not None
                        else terrain_source_sha256
                        if measured_terrain
                        else source_sha256
                        if not terrain
                        else None,
                        "Structure collision is compiled from recorded OSM building footprints"
                        if osm_structure_source is not None
                        else "Collision heightfield is compiled from measured elevation"
                        if measured_terrain
                        else "No-data water cells are not declared traversable"
                        if terrain
                        else "Stable collision is compiled separately from the procedural terrain",
                    ),
                    "acquisitionDate": configuration.acquired_at,
                    "sourceDate": configuration.source_date,
                    "transformationVersion": COMPILER_VERSION,
                    "accuracyM": None,
                    "confidence": (
                        0.9 if measured_terrain else 0.55 if terrain else 0.25 if deliberate_gap else 0.4
                    ),
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


def _disconnected_after(
    points: list[LocalPoint], canonical_route: dict[str, object]
) -> frozenset[int]:
    raw_discontinuities = canonical_route.get("discontinuities")
    if not isinstance(raw_discontinuities, list):
        raise ValidationError("canonical route discontinuities are invalid")
    result: set[int] = set()
    for discontinuity in raw_discontinuities:
        if not isinstance(discontinuity, dict):
            raise ValidationError("canonical route discontinuity is invalid")
        start = float(discontinuity["startDistanceM"])
        end = float(discontinuity["endDistanceM"])
        candidates = [
            index
            for index in range(len(points) - 1)
            if points[index].distance_m <= start
            and points[index + 1].distance_m >= end
        ]
        if len(candidates) != 1:
            raise ValidationError(
                "recorded discontinuity does not map to exactly one route edge"
            )
        result.add(candidates[0])
    return frozenset(result)


def _navigation_document(
    points: list[LocalPoint], disconnected_after: frozenset[int]
) -> dict[str, object]:
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
        if index not in disconnected_after
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
        points = route_local_points(canonical_route)
        structure_tilesets = tuple(
            StructureTileset.load(path)
            for path in configuration.structure_tileset_paths
        )
        structure_dataset_ids = [tileset.dataset_id for tileset in structure_tilesets]
        if len(set(structure_dataset_ids)) != len(structure_dataset_ids):
            raise ValidationError("structure tileset dataset IDs must be unique")
        normalized_terrain: NormalizedTerrain | None = None
        normalized_terrain_bytes: bytes | None = None
        normalized_terrain_record: ObjectRecord | None = None
        if configuration.normalized_terrain_path is not None:
            terrain_path = configuration.normalized_terrain_path
            if not terrain_path.is_file() or terrain_path.is_symlink():
                raise ValidationError(
                    f"normalized terrain is not a regular source file: {terrain_path}"
                )
            normalized_terrain = NormalizedTerrain.load(terrain_path)
            terrain_origin = normalized_terrain.document["origin"]
            assert isinstance(terrain_origin, dict)
            route_origin = canonical_route["coordinates"][0]
            assert isinstance(route_origin, dict)
            if terrain_origin != {
                "latitude": route_origin["latitude"],
                "longitude": route_origin["longitude"],
                "elevationM": route_origin["elevationM"],
            }:
                raise ValidationError(
                    "normalized terrain origin does not match canonical route origin"
                )
            normalized_terrain_bytes = terrain_path.read_bytes()
            normalized_terrain_record = self.store.admit(
                normalized_terrain_bytes,
                media_type="application/json",
                format_version="godiesel-normalized-terrain-v1",
            )
        route_origin = canonical_route["coordinates"][0]
        assert isinstance(route_origin, dict)
        osm_paths = (
            (configuration.osm_network_path,)
            if configuration.osm_network_path is not None
            else configuration.osm_network_paths
        )
        osm_uris = (
            (configuration.osm_source_uri,)
            if configuration.osm_network_path is not None
            else configuration.osm_source_uris
        )
        osm_world = (
            OsmWorldData.load_many(
                osm_paths,
                points,
                origin_latitude=float(route_origin["latitude"]),
                origin_longitude=float(route_origin["longitude"]),
                exploration_radius_m=configuration.exploration_radius_m,
            )
            if osm_paths
            else None
        )
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
            terrain_source_artifact = None
            if normalized_terrain is not None and normalized_terrain_bytes is not None:
                terrain_source_artifact = assembler.add(
                    "sources/derived/normalized-terrain.json",
                    normalized_terrain_bytes,
                    media_type="application/json",
                    format_version="godiesel-normalized-terrain-v1",
                    evidence_class="derived",
                    role="normalized-terrain-source",
                    required_runtime=False,
                    kind="source",
                )
            osm_raw_source_artifacts = (
                [
                    assembler.add(
                        f"sources/original/osm-overpass/{index:03d}.json",
                        path.read_bytes(),
                        media_type="application/json",
                        format_version="osm-overpass-json-0.6",
                        evidence_class="recorded",
                        role="osm-overpass-source-shard",
                        required_runtime=False,
                        kind="source",
                    )
                    for index, path in enumerate(osm_paths)
                ]
                if osm_world is not None
                else []
            )
            osm_source_artifact = (
                assembler.add(
                    "sources/derived/osm-route-world.json",
                    osm_world.normalized_bytes,
                    media_type="application/json",
                    format_version="godiesel-osm-route-world-v1",
                    evidence_class="derived",
                    role="normalized-osm-world-source",
                    required_runtime=False,
                    kind="source",
                )
                if osm_world is not None
                else None
            )
            structure_source_artifacts = []
            for tileset in structure_tilesets:
                structure_source_artifacts.append(
                    (
                        tileset,
                        assembler.add(
                            f"sources/derived/structures/{tileset.dataset_id}/source-manifest.json",
                            (tileset.root / "source-manifest.json").read_bytes(),
                            media_type="application/json",
                            format_version="godiesel-plateau-subset-manifest-v1",
                            evidence_class="derived",
                            role="structure-source-manifest",
                            required_runtime=False,
                            kind="source",
                        ),
                    )
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
                ]
                + (
                    [
                        {
                            "logicalName": "normalized-terrain",
                            "logicalPath": terrain_source_artifact.logicalPath,
                            "sha256": terrain_source_artifact.sha256,
                            "byteSize": terrain_source_artifact.byteSize,
                            "mediaType": terrain_source_artifact.mediaType,
                            "formatVersion": terrain_source_artifact.formatVersion,
                            "evidenceClass": terrain_source_artifact.evidenceClass,
                            "sourceUri": normalized_terrain.document["source"]["sourceUri"],
                            "acquiredAt": configuration.acquired_at,
                            "sourceDate": configuration.source_date,
                            "licence": normalized_terrain.document["source"]["licence"],
                            "attribution": normalized_terrain.document["source"]["attribution"],
                            "adapter": "godiesel-raster-normalizer",
                            "adapterVersion": "1",
                        }
                    ]
                    if terrain_source_artifact is not None and normalized_terrain is not None
                    else []
                )
                + [
                    {
                        "logicalName": f"structure-source-{tileset.dataset_id}",
                        "logicalPath": artifact.logicalPath,
                        "sha256": artifact.sha256,
                        "byteSize": artifact.byteSize,
                        "mediaType": artifact.mediaType,
                        "formatVersion": artifact.formatVersion,
                        "evidenceClass": artifact.evidenceClass,
                        "sourceUri": tileset.source_tileset_uri,
                        "acquiredAt": configuration.acquired_at,
                        "sourceDate": str(tileset.source_year),
                        "licence": configuration.structure_licence,
                        "attribution": configuration.structure_attribution,
                        "adapter": "godiesel-plateau-subset",
                        "adapterVersion": "1",
                    }
                    for tileset, artifact in structure_source_artifacts
                ]
                + (
                    [
                        {
                            "logicalName": "osm-route-world",
                            "logicalPath": osm_source_artifact.logicalPath,
                            "sha256": osm_source_artifact.sha256,
                            "byteSize": osm_source_artifact.byteSize,
                            "mediaType": osm_source_artifact.mediaType,
                            "formatVersion": osm_source_artifact.formatVersion,
                            "evidenceClass": osm_source_artifact.evidenceClass,
                            "sourceUri": "godiesel:normalized-osm-route-world-v1",
                            "acquiredAt": configuration.acquired_at,
                            "sourceDate": osm_world.source_date,
                            "licence": configuration.osm_licence,
                            "attribution": configuration.osm_attribution,
                            "adapter": "godiesel-osm-route-world-normalizer",
                            "adapterVersion": "1",
                        }
                    ]
                    if osm_source_artifact is not None and osm_world is not None
                    else []
                )
                + [
                    {
                        "logicalName": f"osm-overpass-shard-{index:03d}",
                        "logicalPath": artifact.logicalPath,
                        "sha256": artifact.sha256,
                        "byteSize": artifact.byteSize,
                        "mediaType": artifact.mediaType,
                        "formatVersion": artifact.formatVersion,
                        "evidenceClass": artifact.evidenceClass,
                        "sourceUri": osm_uris[index],
                        "acquiredAt": configuration.acquired_at,
                        "sourceDate": osm_world.source_dates[index],
                        "licence": configuration.osm_licence,
                        "attribution": configuration.osm_attribution,
                        "adapter": "overpass-json-route-shard",
                        "adapterVersion": "1",
                    }
                    for index, artifact in enumerate(osm_raw_source_artifacts)
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
            disconnected_after = _disconnected_after(points, canonical_route)
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
                route_thread_glb(points, disconnected_after=disconnected_after),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="derived",
                role="route-thread",
                required_runtime=True,
                transform_name="compile-route-thread-glb",
            )
            terrain_evidence_class = (
                "measured"
                if normalized_terrain is not None
                and normalized_terrain.measured_vertex_count
                == len(normalized_terrain.heights_m)
                else "derived"
                if normalized_terrain is not None
                else "procedural"
            )
            terrain_transform_input = (
                (normalized_terrain_record.sha256,)
                if normalized_terrain_record is not None
                else None
            )
            terrain_visual = assembler.add(
                "terrain/surface/core-terrain.glb",
                normalized_terrain.visual_glb()
                if normalized_terrain is not None
                else terrain_glb(
                    points,
                    exploration_radius_m=configuration.exploration_radius_m,
                    cell_size_m=configuration.quality_cell_size_m,
                    name="Procedural visual terrain",
                ),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class=terrain_evidence_class,
                role="visual-terrain",
                required_runtime=True,
                transform_name=(
                    "compile-normalized-visual-terrain"
                    if normalized_terrain is not None
                    else "compile-procedural-visual-terrain"
                ),
                transform_inputs=terrain_transform_input,
            )
            terrain_collision = assembler.add(
                "physics/terrain-collision.glb",
                normalized_terrain.collision_glb()
                if normalized_terrain is not None
                else terrain_glb(
                    points,
                    exploration_radius_m=configuration.exploration_radius_m,
                    cell_size_m=configuration.quality_cell_size_m,
                    name="Stable terrain collision",
                ),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class=terrain_evidence_class,
                role="terrain-collision",
                required_runtime=True,
                transform_name=(
                    "compile-normalized-terrain-collision"
                    if normalized_terrain is not None
                    else "compile-stable-terrain-collision"
                ),
                transform_inputs=terrain_transform_input,
            )
            terrain_mask = (
                assembler.add_json(
                    "physics/terrain-mask.json",
                    normalized_terrain.mask_document(),
                    format_version="1",
                    evidence_class="derived",
                    role="terrain-mask",
                    required_runtime=True,
                    transform_name="compile-normalized-terrain-mask",
                    transform_inputs=terrain_transform_input,
                )
                if normalized_terrain is not None
                else None
            )
            structures_collision = assembler.add(
                "physics/structures-collision.glb",
                osm_world.collision_glb(points, normalized_terrain)
                if osm_world is not None
                else empty_glb("No admitted structures"),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class=(
                    "derived" if osm_world is not None else "unavailable"
                ),
                role="structures-collision",
                required_runtime=True,
                transform_name=(
                    "compile-osm-structure-collision"
                    if osm_world is not None
                    else "compile-empty-structures-collision"
                ),
                transform_inputs=(osm_world.sha256,) if osm_world is not None else None,
            )
            traversable = assembler.add(
                "physics/traversable-surfaces.glb",
                route_ribbon_glb(points, disconnected_after=disconnected_after),
                media_type="model/gltf-binary",
                format_version="glTF-2.0",
                evidence_class="procedural",
                role="traversable-surfaces",
                required_runtime=True,
                transform_name="compile-route-traversable-surface",
            )
            navigation = _navigation_document(points, disconnected_after)
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
                osm_world.transportation_document()
                if osm_world is not None
                else {
                    "schemaVersion": 1,
                    "roads": {"class": "unavailable", "features": []},
                    "paths": {"class": "unavailable", "features": []},
                    "trails": {"class": "unavailable", "features": []},
                },
                format_version="1",
                evidence_class=(
                    "recorded" if osm_world is not None else "unavailable"
                ),
                role="transportation-network",
                required_runtime=False,
                transform_name=(
                    "normalize-osm-transportation"
                    if osm_world is not None
                    else "declare-unavailable-transportation"
                ),
                transform_inputs=(osm_world.sha256,) if osm_world is not None else None,
            )
            structure_runtime_paths = []
            structure_runtime_descriptors = []
            structure_tileset_records = []
            structure_source_hashes = {
                tileset.dataset_id: artifact.sha256
                for tileset, artifact in structure_source_artifacts
            }
            for tileset in structure_tilesets:
                prefix = f"structures/tilesets/{tileset.dataset_id}"
                tileset_record = assembler.add(
                    f"{prefix}/tileset.json",
                    (tileset.root / "tileset.json").read_bytes(),
                    media_type="application/json",
                    format_version="3d-tiles-1.0",
                    evidence_class="derived",
                    role="structure-tileset",
                    required_runtime=True,
                    transform_name="retain-plateau-structure-tileset",
                    transform_inputs=(structure_source_hashes[tileset.dataset_id],),
                )
                structure_runtime_paths.append(tileset_record.logicalPath)
                structure_runtime_descriptors.append(
                    {
                        "path": tileset_record.logicalPath,
                        "verticalAlignmentOffsetM": tileset.vertical_alignment_offset_m,
                    }
                )
                structure_tileset_records.append(tileset_record)
                for content in tileset.contents:
                    assembler.add(
                        f"{prefix}/{content.uri}",
                        (tileset.root / content.uri).read_bytes(),
                        media_type="application/vnd.cesium.b3dm",
                        format_version="3d-tiles-b3dm-1.0",
                        evidence_class="derived",
                        role="structure-content",
                        required_runtime=True,
                        transform_name="retain-stripped-plateau-b3dm",
                        transform_inputs=(structure_source_hashes[tileset.dataset_id],),
                    )
            if structure_runtime_paths:
                assembler.add_json(
                    "structures/tileset.json",
                    {
                        "schemaVersion": 1,
                        "class": "derived",
                        "contents": structure_runtime_paths,
                    },
                    format_version="1",
                    evidence_class="derived",
                    role="structure-tileset-index",
                    required_runtime=False,
                    transform_name="index-retained-structures",
                )
            else:
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
            coverage_origin = canonical_route["coordinates"][0]
            assert isinstance(coverage_origin, dict)
            coverage = _coverage_document(
                points,
                configuration,
                source_record.sha256,
                normalized_terrain,
                structure_tilesets,
                osm_world,
                origin_latitude=float(coverage_origin["latitude"]),
                origin_longitude=float(coverage_origin["longitude"]),
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
            terrain_alignment = (
                normalized_terrain.document["verticalAlignment"]
                if normalized_terrain is not None
                else None
            )
            assert terrain_alignment is None or isinstance(terrain_alignment, dict)
            assembler.add_json(
                "provenance/accuracy.json",
                {
                    "schemaVersion": 1,
                    "route": {"class": "derived", "declaredAccuracyM": None},
                    "terrain": (
                        {
                            "class": "measured",
                            "declaredAccuracyM": terrain_alignment["residualP95M"],
                            "verticalAlignmentOffsetM": terrain_alignment["offsetM"],
                        }
                        if terrain_alignment is not None
                        else {"class": "procedural", "declaredAccuracyM": None}
                    ),
                    "collision": (
                        {
                            "class": "derived",
                            "declaredAccuracyM": terrain_alignment["residualP95M"],
                        }
                        if terrain_alignment is not None
                        else {"class": "procedural", "declaredAccuracyM": None}
                    ),
                    **(
                        {
                            "structures": [
                                {
                                    "datasetId": tileset.dataset_id,
                                    "class": "derived",
                                    "verticalAlignmentOffsetM": tileset.vertical_alignment_offset_m,
                                    "verticalAlignmentResidualP95M": tileset.vertical_alignment_residual_p95_m,
                                    "verticalAlignmentSampleCount": tileset.vertical_alignment_sample_count,
                                }
                                for tileset in structure_tilesets
                            ]
                        }
                        if structure_tilesets
                        else {}
                    ),
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
                    ]
                    + (
                        [
                            {
                                "scope": terrain_source_artifact.logicalPath,
                                "licence": normalized_terrain.document["source"]["licence"],
                                "attribution": normalized_terrain.document["source"]["attribution"],
                            }
                        ]
                        if terrain_source_artifact is not None and normalized_terrain is not None
                        else []
                    )
                    + [
                        {
                            "scope": artifact.logicalPath,
                            "licence": configuration.structure_licence,
                            "attribution": configuration.structure_attribution,
                        }
                        for _, artifact in structure_source_artifacts
                    ]
                    + (
                        [
                            {
                                "scope": osm_source_artifact.logicalPath,
                                "licence": configuration.osm_licence,
                                "attribution": configuration.osm_attribution,
                            }
                        ]
                        if osm_source_artifact is not None
                        else []
                    ),
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
                    **(
                        {"terrainMask": terrain_mask.logicalPath}
                        if terrain_mask is not None
                        else {}
                    ),
                    **(
                        {"structureTilesets": structure_runtime_descriptors}
                        if structure_runtime_paths
                        else {}
                    ),
                    "structuresCollision": structures_collision.logicalPath,
                    "traversableSurfaces": traversable.logicalPath,
                    "navigation": navigation_record.logicalPath,
                    "coverage": coverage_record.logicalPath,
                    "cameraTimeline": camera_record.logicalPath,
                },
                "physicalCapabilities": {
                    "terrainCollision": "heightfield",
                    "traversableSurfaces": "indexed-triangle-mesh",
                    "structuresCollision": (
                        "footprint-prisms"
                        if osm_world is not None
                        else "unavailable"
                    ),
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
                )
                + tuple(record.sha256 for record in structure_tileset_records),
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
