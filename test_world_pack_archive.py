import stat
import warnings
import zipfile
from pathlib import Path

import pytest

from world_packs.archive import (
    ARCHIVE_TIMESTAMP,
    ArchiveLimits,
    export_pack,
    import_pack,
)
from world_packs.canonical import (
    canonical_json_document,
    sha256_file,
    strict_json_load,
)
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.errors import IntegrityError
from world_packs.verification import inspect_pack, verify_pack


ROOT = Path(__file__).resolve().parent
TOKYO = ROOT / "app/public/data/routes/17665674778.json"


def build_pack(root: Path):
    return WorldPackCompiler(root).build_route(
        TOKYO,
        BuildConfiguration(
            world_id="tokyo-archive-test",
            acquired_at="2026-08-26T00:00:00Z",
            corridor_radius_m=100,
            exploration_radius_m=150,
            quality_cell_size_m=100,
            source_uri="repository:tokyo-fixture@9d82ce0b",
            source_date="2025-11-26",
            deliberate_missing_cell_offsets=((0, 0),),
        ),
    )


def make_writable(path: Path) -> None:
    path.chmod(0o755)
    for child in path.rglob("*"):
        child.chmod(0o755 if child.is_dir() else 0o644)


def test_verifier_checks_identity_checksums_runtime_and_lineage(tmp_path: Path):
    result = build_pack(tmp_path / "repository")

    health = verify_pack(result.path)

    assert health.status == "complete"
    assert health.packId == result.pack_id
    assert health.fileCount == 27
    assert health.artifactCount == 25
    assert health.requiredRuntimeArtifactCount >= 10
    assert inspect_pack(result.path) == health


@pytest.mark.parametrize(
    "relative_path",
    [
        "terrain/surface/core-terrain.glb",
        "sources/original/route-detail.json",
        "cinematic/experience-manifest.json",
    ],
)
def test_verifier_detects_any_artifact_or_source_tamper(
    tmp_path: Path, relative_path: str
):
    result = build_pack(tmp_path / "repository")
    target = result.path / relative_path
    target.chmod(0o644)
    target.write_bytes(target.read_bytes() + b"tamper")

    with pytest.raises(IntegrityError, match="size mismatch|digest mismatch"):
        verify_pack(result.path, require_directory_name=False)


def test_verifier_rejects_extra_file_and_pack_path_symlink(tmp_path: Path):
    result = build_pack(tmp_path / "repository")
    result.path.chmod(0o755)
    extra = result.path / "untracked.bin"
    extra.write_bytes(b"not declared")
    with pytest.raises(IntegrityError, match="extra"):
        verify_pack(result.path)

    extra.unlink()
    result.path.chmod(0o555)
    alias = tmp_path / "pack-alias"
    alias.symlink_to(result.path, target_is_directory=True)
    with pytest.raises(IntegrityError, match="symbolic link"):
        verify_pack(alias)


def test_pack_identity_rejects_rewritten_manifest_and_checksum_claim(tmp_path: Path):
    result = build_pack(tmp_path / "repository")
    make_writable(result.path)
    manifest_path = result.path / "manifest.json"
    checksums_path = result.path / "checksums.json"
    manifest = strict_json_load(manifest_path)
    checksums = strict_json_load(checksums_path)
    assert isinstance(manifest, dict)
    assert isinstance(checksums, dict)
    forged_pack_id = f"wp_{'f' * 64}"
    manifest["packId"] = forged_pack_id
    manifest_path.write_bytes(canonical_json_document(manifest))
    checksums["packId"] = forged_pack_id
    for entry in checksums["files"]:
        if entry["path"] == "manifest.json":
            entry["sha256"] = sha256_file(manifest_path)
            entry["byteSize"] = manifest_path.stat().st_size
    checksums_path.write_bytes(canonical_json_document(checksums))

    with pytest.raises(IntegrityError, match="pack identity mismatch"):
        verify_pack(result.path, require_directory_name=False)


def test_export_is_byte_identical_and_has_normalized_zip_metadata(tmp_path: Path):
    result = build_pack(tmp_path / "repository")
    first = export_pack(result.path, tmp_path / "first.worldpack.zip")
    second = export_pack(result.path, tmp_path / "second.worldpack.zip")

    assert first.sha256 == second.sha256
    assert first.path.read_bytes() == second.path.read_bytes()
    with zipfile.ZipFile(first.path) as archive:
        entries = archive.infolist()
        assert [entry.filename for entry in entries] == sorted(
            entry.filename for entry in entries
        )
        assert all(entry.date_time == ARCHIVE_TIMESTAMP for entry in entries)
        assert all(entry.compress_type == zipfile.ZIP_STORED for entry in entries)
        assert all(stat.S_IMODE(entry.external_attr >> 16) == 0o444 for entry in entries)


def test_clean_repository_import_preserves_pack_identity(tmp_path: Path):
    built = build_pack(tmp_path / "source-repository")
    archive = export_pack(built.path, tmp_path / "portable.worldpack.zip")

    imported = import_pack(archive.path, tmp_path / "clean-repository")

    assert imported.pack_id == built.pack_id
    assert imported.sha256 == archive.sha256
    assert verify_pack(imported.path).packId == built.pack_id
    current = strict_json_load(
        tmp_path / "clean-repository/packs/tokyo-archive-test/current.json"
    )
    assert current == {
        "schemaVersion": 1,
        "packId": built.pack_id,
        "path": built.pack_id,
    }


def write_malicious_archive(
    path: Path,
    entries: list[tuple[zipfile.ZipInfo | str, bytes]],
) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, value in entries:
            archive.writestr(name, value)


@pytest.mark.parametrize("unsafe_name", ["../escape", "/absolute", "a\\b"])
def test_import_rejects_path_traversal(tmp_path: Path, unsafe_name: str):
    archive = tmp_path / "unsafe.zip"
    write_malicious_archive(
        archive,
        [
            (unsafe_name, b"escape"),
            ("manifest.json", b"{}"),
            ("checksums.json", b"{}"),
        ],
    )

    with pytest.raises(IntegrityError, match="unsafe path"):
        import_pack(archive, tmp_path / "repository")
    assert not (tmp_path / "escape").exists()


def test_import_rejects_duplicate_symlink_compression_and_limits(tmp_path: Path):
    duplicate = tmp_path / "duplicate.zip"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        write_malicious_archive(
            duplicate,
            [
                ("manifest.json", b"{}"),
                ("manifest.json", b"{}"),
                ("checksums.json", b"{}"),
            ],
        )
    with pytest.raises(IntegrityError, match="duplicate"):
        import_pack(duplicate, tmp_path / "duplicate-repository")

    symlink = tmp_path / "symlink.zip"
    link = zipfile.ZipInfo("linked")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    write_malicious_archive(
        symlink,
        [(link, b"target"), ("manifest.json", b"{}"), ("checksums.json", b"{}")],
    )
    with pytest.raises(IntegrityError, match="symbolic link"):
        import_pack(symlink, tmp_path / "symlink-repository")

    compressed = tmp_path / "compressed.zip"
    with zipfile.ZipFile(compressed, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", b"{}" * 100)
        archive.writestr("checksums.json", b"{}" * 100)
    with pytest.raises(IntegrityError, match="not deterministically stored"):
        import_pack(compressed, tmp_path / "compressed-repository")

    oversized = tmp_path / "oversized.zip"
    write_malicious_archive(
        oversized,
        [("manifest.json", b"12345"), ("checksums.json", b"{}")],
    )
    with pytest.raises(IntegrityError, match="size limit"):
        import_pack(
            oversized,
            tmp_path / "oversized-repository",
            limits=ArchiveLimits(maximum_file_bytes=4),
        )


def test_import_never_overwrites_conflicting_pack_directory(tmp_path: Path):
    built = build_pack(tmp_path / "source-repository")
    archive = export_pack(built.path, tmp_path / "portable.worldpack.zip")
    repository = tmp_path / "target-repository"
    conflict = repository / f"packs/tokyo-archive-test/{built.pack_id}"
    conflict.mkdir(parents=True)
    marker = conflict / "owner-data"
    marker.write_bytes(b"must remain")

    with pytest.raises(IntegrityError, match="conflicting pack directory"):
        import_pack(archive.path, repository)

    assert marker.read_bytes() == b"must remain"
