"""Non-destructive World Pack schema migration framework."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .errors import MigrationError
from .verification import PackHealth, verify_pack


CURRENT_SCHEMA_VERSION = 1
Migration = Callable[[dict[str, object]], dict[str, object]]


@dataclass(frozen=True)
class MigrationResult:
    path: Path
    source_version: int
    target_version: int
    changed: bool
    health: PackHealth


class MigrationRegistry:
    def __init__(self) -> None:
        self._steps: dict[tuple[int, int], Migration] = {}

    def register(self, source: int, target: int, migration: Migration) -> None:
        if target != source + 1 or source < 0:
            raise MigrationError("migrations must advance exactly one schema version")
        key = (source, target)
        if key in self._steps:
            raise MigrationError(f"migration is already registered: {source} -> {target}")
        self._steps[key] = migration

    def migrate_document(
        self,
        document: dict[str, object],
        *,
        target: int = CURRENT_SCHEMA_VERSION,
    ) -> dict[str, object]:
        source = document.get("schemaVersion")
        if isinstance(source, bool) or not isinstance(source, int) or source < 0:
            raise MigrationError("document has no supported schema version")
        if source > target:
            raise MigrationError(
                f"document schema {source} is newer than supported target {target}"
            )
        migrated = dict(document)
        while source < target:
            step = self._steps.get((source, source + 1))
            if step is None:
                raise MigrationError(f"no migration path from schema {source} to {target}")
            migrated = step(dict(migrated))
            if migrated.get("schemaVersion") != source + 1:
                raise MigrationError(
                    f"migration {source} -> {source + 1} returned the wrong version"
                )
            source += 1
        return migrated


def migrate_pack(pack: Path, *, target: int = CURRENT_SCHEMA_VERSION) -> MigrationResult:
    health = verify_pack(pack)
    manifest_path = pack / "manifest.json"
    from .canonical import strict_json_load

    manifest = strict_json_load(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("schemaVersion"), int):
        raise MigrationError("pack manifest has no supported schema version")
    source_version = int(manifest["schemaVersion"])
    if source_version > target:
        raise MigrationError(
            f"pack schema {source_version} is newer than supported target {target}"
        )
    if source_version < target:
        raise MigrationError(
            "no sealed-pack migration is registered; the original pack was not modified"
        )
    return MigrationResult(pack.resolve(), source_version, target, False, health)
