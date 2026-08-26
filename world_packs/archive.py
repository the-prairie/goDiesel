"""Deterministic portable archive export and bounded hostile-input import."""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .canonical import sha256_file, strict_json_load
from .compiler import WorldPackCompiler
from .errors import IntegrityError
from .storage import ContentAddressedStore
from .verification import verify_pack


ARCHIVE_SUFFIX = ".worldpack.zip"
ARCHIVE_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class ArchiveLimits:
    maximum_entries: int = 20_000
    maximum_file_bytes: int = 8 * 1024 * 1024 * 1024
    maximum_total_bytes: int = 64 * 1024 * 1024 * 1024


@dataclass(frozen=True)
class ArchiveResult:
    path: Path
    sha256: str
    byte_size: int
    pack_id: str


def export_pack(pack: Path, destination: Path) -> ArchiveResult:
    health = verify_pack(pack)
    if destination.exists() and destination.is_dir():
        destination = destination / f"{health.packId}{ARCHIVE_SUFFIX}"
    if destination.exists() or destination.is_symlink():
        raise IntegrityError(f"archive destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", dir=destination.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
            strict_timestamps=True,
        ) as archive:
            for path in sorted(candidate for candidate in pack.rglob("*") if candidate.is_file()):
                relative_path = path.relative_to(pack).as_posix()
                info = zipfile.ZipInfo(relative_path, ARCHIVE_TIMESTAMP)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (stat.S_IFREG | 0o444) << 16
                archive.writestr(info, path.read_bytes())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return ArchiveResult(
        destination,
        sha256_file(destination),
        destination.stat().st_size,
        str(health.packId),
    )


def _safe_member(info: zipfile.ZipInfo) -> str:
    name = info.filename
    if not name or "\\" in name or "\0" in name:
        raise IntegrityError(f"archive contains unsafe path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise IntegrityError(f"archive contains unsafe path: {name!r}")
    if info.is_dir():
        raise IntegrityError(f"archive contains a directory entry: {name}")
    unix_mode = info.external_attr >> 16
    if unix_mode and stat.S_ISLNK(unix_mode):
        raise IntegrityError(f"archive contains a symbolic link: {name}")
    if info.flag_bits & 0x1:
        raise IntegrityError(f"archive contains an encrypted entry: {name}")
    if info.compress_type != zipfile.ZIP_STORED:
        raise IntegrityError(f"archive entry is not deterministically stored: {name}")
    return name


def import_pack(
    archive_path: Path,
    repository: Path,
    *,
    limits: ArchiveLimits = ArchiveLimits(),
) -> ArchiveResult:
    if not archive_path.is_file() or archive_path.is_symlink():
        raise IntegrityError(f"archive is not a regular file: {archive_path}")
    repository = repository.resolve()
    imports = repository / ".imports"
    imports.mkdir(parents=True, exist_ok=True)
    staging = imports / uuid.uuid4().hex
    staging.mkdir()
    try:
        with zipfile.ZipFile(archive_path, "r", allowZip64=True) as archive:
            entries = archive.infolist()
            if len(entries) > limits.maximum_entries:
                raise IntegrityError("archive exceeds the entry-count limit")
            names: set[str] = set()
            total_bytes = 0
            for info in entries:
                name = _safe_member(info)
                if name in names:
                    raise IntegrityError(f"archive contains duplicate path: {name}")
                names.add(name)
                if info.file_size > limits.maximum_file_bytes:
                    raise IntegrityError(f"archive entry exceeds size limit: {name}")
                total_bytes += info.file_size
                if total_bytes > limits.maximum_total_bytes:
                    raise IntegrityError("archive exceeds the total-size limit")
            if {"manifest.json", "checksums.json"} - names:
                raise IntegrityError("archive is missing manifest or checksums")
            for info in entries:
                target = staging / info.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                with archive.open(info, "r") as source, target.open("xb") as output:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > info.file_size:
                            raise IntegrityError(
                                f"archive expanded beyond declared size: {info.filename}"
                            )
                        output.write(chunk)
                if written != info.file_size:
                    raise IntegrityError(
                        f"archive entry size mismatch: {info.filename}"
                    )
                target.chmod(0o444)
        health = verify_pack(staging, require_directory_name=False)
        manifest = strict_json_load(staging / "manifest.json")
        if not isinstance(manifest, dict):
            raise IntegrityError("imported manifest is invalid")
        world_id = manifest.get("worldId")
        pack_id = manifest.get("packId")
        if not isinstance(world_id, str) or not isinstance(pack_id, str):
            raise IntegrityError("imported pack identity is invalid")
        compiler = WorldPackCompiler(repository)
        final = compiler.packs / world_id / pack_id
        quarantine: Path | None = None
        if final.exists():
            installed_identity = None
            installed_manifest = final / "manifest.json"
            current_pointer = final.parent / "current.json"
            if installed_manifest.is_file():
                try:
                    installed_value = strict_json_load(installed_manifest)
                    if isinstance(installed_value, dict):
                        installed_identity = installed_value.get("packId")
                except Exception:
                    pass
            if installed_identity is None and current_pointer.is_file():
                try:
                    current_value = strict_json_load(current_pointer)
                    if isinstance(current_value, dict):
                        installed_identity = current_value.get("packId")
                except Exception:
                    pass
            if installed_identity != pack_id:
                raise IntegrityError(
                    f"conflicting pack directory has no matching identity: {final}"
                )
            try:
                verify_pack(final)
            except Exception:
                quarantine = (
                    repository
                    / "quarantine"
                    / world_id
                    / f"{pack_id}.{uuid.uuid4().hex}"
                )
                quarantine.parent.mkdir(parents=True, exist_ok=True)
                final.chmod(0o755)
                os.replace(final, quarantine)
        try:
            result = compiler._promote(staging, world_id, pack_id)
            _populate_content_store(result.path, repository)
            verify_pack(result.path)
        except Exception:
            if quarantine is not None:
                if final.exists():
                    compiler._make_writable(final)
                    shutil.rmtree(final)
                os.replace(quarantine, final)
            raise
        return ArchiveResult(
            result.path,
            sha256_file(archive_path),
            archive_path.stat().st_size,
            str(health.packId),
        )
    except Exception:
        if staging.exists():
            WorldPackCompiler._make_writable(staging)
            shutil.rmtree(staging)
        raise


def _populate_content_store(pack: Path, repository: Path) -> None:
    manifest = strict_json_load(pack / "manifest.json")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("artifacts"), list):
        raise IntegrityError("imported manifest artifact inventory is invalid")
    store = ContentAddressedStore(repository / "objects")
    for artifact in manifest["artifacts"]:
        if not isinstance(artifact, dict):
            raise IntegrityError("imported manifest artifact record is invalid")
        logical_path = artifact.get("logicalPath")
        media_type = artifact.get("mediaType")
        format_version = artifact.get("formatVersion")
        expected_digest = artifact.get("sha256")
        if not all(
            isinstance(value, str)
            for value in (logical_path, media_type, format_version, expected_digest)
        ):
            raise IntegrityError("imported manifest artifact record is incomplete")
        record = store.admit(
            (pack / logical_path).read_bytes(),
            media_type=media_type,
            format_version=format_version,
        )
        if record.sha256 != expected_digest:
            raise IntegrityError(
                f"imported artifact digest changed during admission: {logical_path}"
            )
