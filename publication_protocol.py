"""Crash recovery shared by the generator backup and the owner journal.

Both publications follow one protocol. A journal directory holds a copy of the
previous artifacts. A `ready` marker says that copy is complete, and a
`committed` marker says the new artifacts are complete. A journal is retired by
renaming it aside and then deleting it, so an interrupted delete never leaves a
partial journal under its live name.

`publication_disposition` is the only rule for what recovery does with a journal
it finds. It is pure: callers observe the disk and the lock, then act.

Recovery is not a runtime state machine, so there is no reducer here (ADR-0018
covers runtime lifecycles, not crash recovery).
"""

from __future__ import annotations

import fcntl
import os
import shutil
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Disposition = Literal["none", "discard", "restore", "committed-cleanup", "blocked"]

GENERATOR_BACKUP_NAME = ".route-generation-backup"
GENERATOR_STAGING_PREFIX = ".routes-staging-"
OWNER_JOURNAL_NAME = ".owner-publication-backup"
OWNER_PREPARING_PREFIX = ".owner-publication-preparing-"


@dataclass(frozen=True)
class JournalMarkers:
    """What recovery observed: the journal, its markers, and a live lock holder."""

    exists: bool
    ready: bool = False
    committed: bool = False
    live: bool = False


def publication_disposition(markers: JournalMarkers) -> Disposition:
    """Decide what recovery does with a journal.

    none               no journal: nothing to do.
    blocked            another live process holds the lock: touch nothing.
    committed-cleanup  the new artifacts are complete: keep them, retire the journal.
    restore            the backup is complete and the new artifacts may be partial:
                       restore the backup, then retire the journal.
    discard            the backup never completed, so nothing was replaced:
                       retire the journal.
    """
    if not markers.exists:
        return "none"
    if markers.live:
        return "blocked"
    if markers.committed:
        return "committed-cleanup"
    if markers.ready:
        return "restore"
    return "discard"


def journal_markers(journal: Path, *, live: bool = False) -> JournalMarkers:
    """Observe a journal's markers on disk."""
    exists = journal.exists()
    return JournalMarkers(
        exists=exists,
        ready=exists and (journal / "ready").exists(),
        committed=exists and (journal / "committed").exists(),
        live=exists and live,
    )


def retire_journal(journal: Path) -> None:
    """Rename a journal aside, then delete it."""
    retired = journal.with_name(f"{journal.name}.cleanup-{uuid.uuid4().hex}")
    journal.rename(retired)
    shutil.rmtree(retired, ignore_errors=True)


class GeneratorPublicationActive(RuntimeError):
    """Another generator run holds the publication lock for this checkout."""


# Generator locks this process holds, by data directory. A run keeps its lock
# until it exits, so its own failure path can restore without reacquiring.
_held_generator_locks: dict[Path, int] = {}


def _try_lock(path: Path) -> int | None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(descriptor)
        return None
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def _generator_lock_key(data_dir: Path) -> Path:
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir.resolve()


def hold_generator_lock(data_dir: Path) -> bool:
    """Take the generator lock for the rest of this process. False if another holds it.

    The lock is an exclusive flock on the published data directory itself, so it
    leaves no file behind in the deployable tree.
    """
    key = _generator_lock_key(data_dir)
    if key in _held_generator_locks:
        return True
    descriptor = _try_lock(key)
    if descriptor is None:
        return False
    _held_generator_locks[key] = descriptor
    return True


def release_generator_lock(data_dir: Path) -> None:
    descriptor = _held_generator_locks.pop(Path(data_dir).resolve(), None)
    if descriptor is not None:
        os.close(descriptor)


@contextmanager
def generator_lock(data_dir: Path):
    """Hold the generator lock for a block. Raises if another process holds it."""
    key = _generator_lock_key(data_dir)
    if key in _held_generator_locks:
        yield
        return
    if not hold_generator_lock(key):
        raise GeneratorPublicationActive(
            f"another generator run is publishing {key}; retry after it finishes"
        )
    try:
        yield
    finally:
        release_generator_lock(key)


def generator_markers(backup: Path) -> JournalMarkers:
    """Observe the generator backup, probing whether another process holds its lock."""
    data_dir = backup.parent
    live = False
    if backup.exists():
        key = data_dir.resolve()
        if key not in _held_generator_locks:
            descriptor = _try_lock(key)
            live = descriptor is None
            if descriptor is not None:
                os.close(descriptor)
    return journal_markers(backup, live=live)


def restore_generator_backup(backup: Path, details: Path, generated_files) -> None:
    """Copy a ready generator backup over the published artifacts."""
    backup_details = backup / "routes"
    if details.exists():
        shutil.rmtree(details)
    if backup_details.exists():
        shutil.copytree(backup_details, details)

    metadata_backup = backup / "metadata"
    for index, path in enumerate(generated_files):
        backup_file = metadata_backup / f"{index}.bin"
        missing_marker = metadata_backup / f"{index}.missing"
        if backup_file.exists():
            temp_path = path.with_name(f".{path.name}.recovery")
            shutil.copyfile(backup_file, temp_path)
            temp_path.replace(path)
        elif missing_marker.exists():
            path.unlink(missing_ok=True)


def recover_generator_publication(
    backup: Path, details: Path, generated_files, checkout_root: Path
) -> Disposition:
    """Take the generator lock, settle any backup, then collect crash leftovers.

    Raises GeneratorPublicationActive, touching nothing, when another run holds
    the lock. The caller keeps the lock until it exits.
    """
    data_dir = backup.parent
    if not hold_generator_lock(data_dir):
        raise GeneratorPublicationActive(
            f"another generator run is publishing {data_dir}; "
            "this run stopped without touching its backup"
        )
    disposition = publication_disposition(journal_markers(backup))
    if disposition == "restore":
        restore_generator_backup(backup, details, generated_files)
    if disposition != "none":
        retire_journal(backup)
    collect_generator_leftovers(backup, details, generated_files, checkout_root)
    return disposition


def write_generator_backup(backup: Path, details: Path, generated_files) -> None:
    """Snapshot the published artifacts, then mark the snapshot ready."""
    if backup.exists():
        raise RuntimeError("Route generation backup already exists after recovery")
    backup.mkdir()
    backup_details = backup / "routes"
    if details.exists():
        shutil.copytree(details, backup_details)
    metadata_backup = backup / "metadata"
    metadata_backup.mkdir()
    for index, path in enumerate(generated_files):
        if path.exists():
            shutil.copyfile(path, metadata_backup / f"{index}.bin")
        else:
            (metadata_backup / f"{index}.missing").touch()
    (backup / "ready").touch()


def commit_generator_backup(backup: Path) -> None:
    """Mark the new generation complete, then retire the backup.

    A failure to retire leaves a committed backup, which the next recovery
    retires without restoring it.
    """
    (backup / "committed").touch()
    try:
        retire_journal(backup)
    except OSError:
        pass


@contextmanager
def _owner_lock_if_abandoned(directory: Path):
    """Yield True while holding a dead owner's lock, False if it is live or unproven."""
    lock_path = directory / "lock"
    try:
        descriptor = _try_lock(lock_path)
    except OSError:
        yield False
        return
    if descriptor is None:
        yield False
        return
    try:
        yield True
    finally:
        os.close(descriptor)


def collect_generator_leftovers(
    backup: Path, details: Path, generated_files, checkout_root: Path
) -> None:
    """Delete crash leftovers that a held lock proves no live process owns.

    The caller holds the generator lock, so no generator run is staging or
    retiring a backup. Owner leftovers carry their own lock. A preparing
    directory counts only once its owner record exists, because the owner
    writes that record after it takes the lock. Temporaries next to published
    files are shared with owner saves, so they are left alone while an owner
    journal exists.
    """
    data_dir = backup.parent
    if data_dir.resolve() not in _held_generator_locks:
        raise RuntimeError("collecting generator leftovers requires the generator lock")
    for leftover in (
        *data_dir.glob(f"{GENERATOR_STAGING_PREFIX}*"),
        *data_dir.glob(f"{backup.name}.cleanup-*"),
    ):
        shutil.rmtree(leftover, ignore_errors=True)

    root = Path(checkout_root)
    for preparation in root.glob(f"{OWNER_PREPARING_PREFIX}*"):
        if not (preparation / "owner.json").exists():
            continue
        with _owner_lock_if_abandoned(preparation) as abandoned:
            if abandoned:
                shutil.rmtree(preparation, ignore_errors=True)
    for retired in root.glob(f"{OWNER_JOURNAL_NAME}.cleanup-*"):
        with _owner_lock_if_abandoned(retired) as abandoned:
            if abandoned:
                shutil.rmtree(retired, ignore_errors=True)

    if (root / OWNER_JOURNAL_NAME).exists():
        return
    for path in generated_files:
        for suffix in (".tmp", ".recovery"):
            path.with_name(f".{path.name}{suffix}").unlink(missing_ok=True)
    if details.is_dir():
        for suffix in (".tmp", ".recovery"):
            for temporary in details.glob(f".*{suffix}"):
                temporary.unlink(missing_ok=True)
