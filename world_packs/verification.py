"""Independent integrity and offline-runtime verification for sealed packs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from .canonical import (
    canonical_json_bytes,
    canonical_json_document,
    sha256_bytes,
    sha256_file,
    strict_json_load,
)
from .errors import IntegrityError, ValidationError
from .geometry import glb_json
from .schema import validate_document
from .transformations import TransformationStep


KNOWN_DOCUMENT_SCHEMAS = {
    "manifest.json": "manifest",
    "checksums.json": "checksums",
    "sources/inventory.json": "source-inventory",
    "route/canonical-route.json": "canonical-route",
    "physics/world-navigation.json": "world-navigation",
    "runtime/world.json": "runtime-world",
    "cinematic/camera-timelines.json": "camera-timelines",
    "cinematic/experience-manifest.json": "experience-manifest",
    "provenance/coverage.json": "coverage",
    "provenance/transformations.json": "transformations",
    "migrations/version.json": "migration-version",
}


@dataclass(frozen=True)
class PackHealth:
    status: str
    packId: str | None
    fileCount: int
    artifactCount: int
    requiredRuntimeArtifactCount: int
    issues: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["issues"] = list(self.issues)
        return value


def _safe_relative_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise IntegrityError(f"{label} is not a safe portable path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise IntegrityError(f"{label} is not a safe portable path: {value!r}")
    return value


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise IntegrityError(f"{label} is not an object")
    return value


def _array(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise IntegrityError(f"{label} is not an array")
    return value


def _external_strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        if value.startswith(("http://", "https://", "file://")) or value.startswith("/"):
            yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _external_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _external_strings(child)


def _validate_canonical_json(pack: Path, relative_path: str) -> object:
    path = pack / relative_path
    value = strict_json_load(path)
    if canonical_json_document(value) != path.read_bytes():
        raise IntegrityError(f"JSON artifact is not canonical: {relative_path}")
    schema = KNOWN_DOCUMENT_SCHEMAS.get(relative_path)
    if schema is not None:
        try:
            validate_document(schema, value)
        except ValidationError as error:
            raise IntegrityError(str(error)) from error
    return value


def _verify_transformation_identities(
    value: object, artifact_hashes: set[str]
) -> set[str]:
    document = _object(value, "transformation graph")
    identities: set[str] = set()
    for raw_step in _array(document.get("steps"), "transformation steps"):
        step = _object(raw_step, "transformation step")
        expected = step.get("identity")
        transformation = TransformationStep(
            name=str(step.get("name", "")),
            version=str(step.get("version", "")),
            inputs=tuple(_array(step.get("inputs"), "transformation inputs")),
            outputs=tuple(_array(step.get("outputs"), "transformation outputs")),
            configuration=_object(
                step.get("configuration"), "transformation configuration"
            ),
        )
        if transformation.identity != expected:
            raise IntegrityError(
                f"transformation identity mismatch: {expected!r}"
            )
        if expected in identities:
            raise IntegrityError(f"duplicate transformation identity: {expected}")
        identities.add(str(expected))
        unknown_outputs = set(transformation.outputs) - artifact_hashes
        if unknown_outputs:
            raise IntegrityError(
                "transformation declares outputs absent from the pack: "
                + ", ".join(sorted(unknown_outputs))
            )
        unknown_inputs = set(transformation.inputs) - artifact_hashes
        if unknown_inputs:
            raise IntegrityError(
                "transformation declares inputs absent from the pack: "
                + ", ".join(sorted(unknown_inputs))
            )
    return identities


def verify_pack(pack: Path, *, require_directory_name: bool = True) -> PackHealth:
    if pack.is_symlink():
        raise IntegrityError(f"pack path is a symbolic link: {pack}")
    pack = pack.resolve()
    if not pack.is_dir():
        raise IntegrityError(f"pack is not a regular directory: {pack}")
    manifest = _object(_validate_canonical_json(pack, "manifest.json"), "manifest")
    checksums = _object(
        _validate_canonical_json(pack, "checksums.json"), "checksums"
    )
    pack_id = manifest.get("packId")
    if pack_id != checksums.get("packId"):
        raise IntegrityError("manifest and checksum pack identities differ")
    if require_directory_name and pack.name != pack_id:
        raise IntegrityError(
            f"pack directory name {pack.name!r} does not match {pack_id!r}"
        )

    checksum_entries = _array(checksums.get("files"), "checksum files")
    checksum_by_path: dict[str, dict[str, Any]] = {}
    for raw_entry in checksum_entries:
        entry = _object(raw_entry, "checksum entry")
        relative_path = _safe_relative_path(entry.get("path"), "checksum path")
        if relative_path in checksum_by_path:
            raise IntegrityError(f"duplicate checksum path: {relative_path}")
        checksum_by_path[relative_path] = entry
    if list(checksum_by_path) != sorted(checksum_by_path):
        raise IntegrityError("checksum inventory is not sorted by path")

    actual_paths = {
        path.relative_to(pack).as_posix()
        for path in pack.rglob("*")
        if path.is_file() and path.name != "checksums.json"
    }
    symlinks = [path for path in pack.rglob("*") if path.is_symlink()]
    if symlinks:
        raise IntegrityError(
            "pack contains symbolic links: "
            + ", ".join(path.relative_to(pack).as_posix() for path in symlinks)
        )
    if actual_paths != set(checksum_by_path):
        missing = sorted(set(checksum_by_path) - actual_paths)
        extra = sorted(actual_paths - set(checksum_by_path))
        raise IntegrityError(f"checksum inventory mismatch; missing={missing}; extra={extra}")
    for relative_path, entry in checksum_by_path.items():
        path = pack / relative_path
        if not path.is_file():
            raise IntegrityError(f"checksummed path is not a file: {relative_path}")
        if path.stat().st_size != entry.get("byteSize"):
            raise IntegrityError(f"file size mismatch: {relative_path}")
        if sha256_file(path) != entry.get("sha256"):
            raise IntegrityError(f"file digest mismatch: {relative_path}")

    artifacts = _array(manifest.get("artifacts"), "manifest artifacts")
    artifact_by_path: dict[str, dict[str, Any]] = {}
    for raw_artifact in artifacts:
        artifact = _object(raw_artifact, "manifest artifact")
        relative_path = _safe_relative_path(
            artifact.get("logicalPath"), "artifact path"
        )
        if relative_path in artifact_by_path:
            raise IntegrityError(f"duplicate artifact path: {relative_path}")
        artifact_by_path[relative_path] = artifact
        checksum = checksum_by_path.get(relative_path)
        if checksum is None:
            raise IntegrityError(f"artifact is not checksummed: {relative_path}")
        if (artifact.get("sha256"), artifact.get("byteSize")) != (
            checksum.get("sha256"),
            checksum.get("byteSize"),
        ):
            raise IntegrityError(f"artifact inventory mismatch: {relative_path}")
    if list(artifact_by_path) != sorted(artifact_by_path):
        raise IntegrityError("artifact inventory is not sorted by path")

    identity = {
        key: value
        for key, value in manifest.items()
        if key not in {"packId", "runtime", "artifacts"}
    }
    identity["artifacts"] = [
        artifact
        for artifact in artifacts
        if artifact.get("role") != "pack-binding"
    ]
    expected_pack_id = f"wp_{sha256_bytes(canonical_json_bytes(identity))}"
    if pack_id != expected_pack_id:
        raise IntegrityError(
            f"pack identity mismatch: {pack_id!r} != {expected_pack_id!r}"
        )

    transformation_identities: set[str] = set()
    artifact_hashes = {str(artifact.get("sha256")) for artifact in artifacts}
    for relative_path, schema in KNOWN_DOCUMENT_SCHEMAS.items():
        if relative_path in {"manifest.json", "checksums.json"}:
            continue
        if relative_path not in artifact_by_path:
            raise IntegrityError(f"required contract document is absent: {relative_path}")
        value = _validate_canonical_json(pack, relative_path)
        if schema == "transformations":
            transformation_identities = _verify_transformation_identities(
                value, artifact_hashes
            )
    for artifact in artifacts:
        transformation_ids = set(
            _array(
                artifact.get("transformationIds"),
                f"artifact transformations for {artifact.get('logicalPath')}",
            )
        )
        unknown = transformation_ids - transformation_identities
        if unknown:
            raise IntegrityError(
                "artifact references unknown transformations: "
                + ", ".join(sorted(unknown))
            )
        exempt = artifact.get("kind") == "source" or artifact.get("role") in {
            "pack-binding",
            "transformation-graph",
        }
        if not exempt and not transformation_ids:
            raise IntegrityError(
                f"derived artifact lacks transformation lineage: {artifact.get('logicalPath')}"
            )

    runtime = _object(
        _validate_canonical_json(pack, "runtime/world.json"), "runtime world"
    )
    runtime_manifest = _object(manifest.get("runtime"), "manifest runtime")
    if runtime_manifest.get("networkRequired") is not False:
        raise IntegrityError("runtime requires network access")
    if runtime_manifest.get("providerCredentialsRequired") is not False:
        raise IntegrityError("runtime requires provider credentials")
    entrypoint = _safe_relative_path(
        runtime_manifest.get("entrypoint"), "runtime entrypoint"
    )
    if entrypoint != "runtime/world.json":
        raise IntegrityError(f"unexpected runtime entrypoint: {entrypoint}")
    assets = _object(runtime.get("assets"), "runtime assets")
    for name, raw_value in assets.items():
        raw_paths = (
            [
                _object(item, f"runtime structure tileset {index}").get("path")
                for index, item in enumerate(raw_value)
            ]
            if name == "structureTilesets" and isinstance(raw_value, list)
            else raw_value
            if isinstance(raw_value, list)
            else [raw_value]
        )
        if not raw_paths:
            raise IntegrityError(f"runtime asset {name} is an empty path array")
        for index, raw_path in enumerate(raw_paths):
            relative_path = _safe_relative_path(
                raw_path,
                f"runtime asset {name}"
                + (f" item {index}" if isinstance(raw_value, list) else ""),
            )
            artifact = artifact_by_path.get(relative_path)
            if artifact is None or artifact.get("requiredRuntime") is not True:
                raise IntegrityError(
                    f"runtime asset is absent or not required: {relative_path}"
                )

    required_runtime = [
        artifact for artifact in artifacts if artifact.get("requiredRuntime") is True
    ]
    for artifact in required_runtime:
        relative_path = str(artifact["logicalPath"])
        path = pack / relative_path
        if artifact.get("mediaType") == "application/json":
            value = _validate_canonical_json(pack, relative_path)
            external = (
                []
                if relative_path == "provenance/attribution.json"
                else list(_external_strings(value))
            )
            if external:
                raise IntegrityError(
                    f"required runtime JSON contains external references in {relative_path}: {external}"
                )
        elif artifact.get("mediaType") == "model/gltf-binary":
            document = glb_json(path.read_bytes())
            external = list(_external_strings(document))
            if external:
                raise IntegrityError(
                    f"required GLB contains external references in {relative_path}: {external}"
                )

    experience = _object(
        _validate_canonical_json(pack, "cinematic/experience-manifest.json"),
        "experience manifest",
    )
    if experience.get("packId") != pack_id:
        raise IntegrityError("cinematic experience is bound to another pack")
    source_inventory = _object(
        _validate_canonical_json(pack, "sources/inventory.json"),
        "source inventory",
    )
    for raw_source in _array(source_inventory.get("sources"), "retained sources"):
        source = _object(raw_source, "retained source")
        relative_path = _safe_relative_path(
            source.get("logicalPath"), "retained source path"
        )
        artifact = artifact_by_path.get(relative_path)
        if artifact is None or artifact.get("kind") != "source":
            raise IntegrityError(f"retained source is absent: {relative_path}")
        if source.get("sha256") != artifact.get("sha256"):
            raise IntegrityError(f"retained source digest mismatch: {relative_path}")

    coverage = _object(
        _validate_canonical_json(pack, "provenance/coverage.json"), "coverage"
    )
    cell_ids = [
        _object(cell, "coverage cell").get("id")
        for cell in _array(coverage.get("cells"), "coverage cells")
    ]
    if len(cell_ids) != len(set(cell_ids)):
        raise IntegrityError("coverage contains duplicate cell identities")

    return PackHealth(
        status="complete",
        packId=str(pack_id),
        fileCount=len(actual_paths) + 1,
        artifactCount=len(artifacts),
        requiredRuntimeArtifactCount=len(required_runtime),
        issues=(),
    )


def inspect_pack(pack: Path, *, require_directory_name: bool = True) -> PackHealth:
    try:
        return verify_pack(pack, require_directory_name=require_directory_name)
    except (IntegrityError, ValidationError, OSError, ValueError) as error:
        return PackHealth(
            status="invalid",
            packId=None,
            fileCount=0,
            artifactCount=0,
            requiredRuntimeArtifactCount=0,
            issues=(str(error),),
        )
