"""Validated owner-curation writes for the local Admin service."""

import copy
import fcntl
import json
import os
import stat
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

from godiesel_evidence import replace_local_file, write_local_text_atomic

from curation_publish import (
    CurationPublishError,
    CurationRecoveryError,
    publish_curation,
)
from godiesel_evidence import ensure_local_directory
from quest_meta import (
    CURATION_LIST_FIELDS,
    CURATION_TEXT_FIELDS,
    build_route_curation,
)

REQUIRED_CURATION_FIELDS = (*CURATION_TEXT_FIELDS, *CURATION_LIST_FIELDS)


class SourceRollbackError(RuntimeError):
    """Canonical curation source could not be restored after publication failed."""

    def __init__(self, message, *, recovery_paths=()):
        super().__init__(message)
        self.recovery_paths = tuple(Path(path) for path in recovery_paths)


class OwnerMutationBusyError(RuntimeError):
    """Another process currently owns the canonical owner-mutation boundary."""


@contextmanager
def owner_mutation_lock(checkout_root):
    """Serialize owner curation across the Admin server and local CLI processes."""

    root = Path(checkout_root).resolve()
    directory_fd = None
    lock_fd = None
    try:
        lock_directory = ensure_local_directory(root, ".godiesel")
        directory_fd = os.open(
            lock_directory,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
        lock_fd = os.open(
            "owner-mutation.lock",
            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
            raise OSError("owner mutation lock is not a regular file")
        opened_directory = os.fstat(directory_fd)

        def directory_is_still_pinned():
            try:
                current_directory = lock_directory.lstat()
            except OSError:
                return False
            return (
                stat.S_ISDIR(current_directory.st_mode)
                and not stat.S_ISLNK(current_directory.st_mode)
                and current_directory.st_dev == opened_directory.st_dev
                and current_directory.st_ino == opened_directory.st_ino
            )

        if not directory_is_still_pinned():
            raise OSError("owner mutation lock directory changed during acquisition")
    except OSError as error:
        if lock_fd is not None:
            os.close(lock_fd)
        if directory_fd is not None:
            os.close(directory_fd)
        raise OwnerMutationBusyError(
            "owner mutation lock boundary is unavailable"
        ) from error
    try:
        with os.fdopen(lock_fd, "a+", encoding="utf-8") as lock_file:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise OwnerMutationBusyError(
                    "another owner mutation is in progress"
                ) from error
            if not directory_is_still_pinned():
                raise OwnerMutationBusyError(
                    "owner mutation lock directory changed during acquisition"
                )
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    finally:
        os.close(directory_fd)


def run_owner_mutation(checkout_root, local_lock, mutation):
    """Run one Admin mutation behind both process-local and checkout-wide locks."""
    if not local_lock.acquire(blocking=False):
        raise OwnerMutationBusyError("another owner mutation is in progress")
    try:
        with owner_mutation_lock(checkout_root):
            return mutation()
    finally:
        local_lock.release()


def save_owner_curation(
    checkout_root,
    activity_id,
    curation,
    runner=subprocess.run,
    *,
    acquire_lock=True,
):
    """Apply one owner-approved curation change through the canonical writers."""
    root = Path(checkout_root).resolve()

    def full_rebuild():
        runner(
            [sys.executable, str(root / "build.py")],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )

    def publish():
        publish_curation_or_rebuild(
            lambda: publish_curation(root, activity_id, curation),
            full_rebuild,
        )

    def save():
        return save_curation_and_rebuild(
            root / "quests.json",
            activity_id,
            curation,
            publish,
        )

    if not acquire_lock:
        return save()
    with owner_mutation_lock(root):
        return save()


def publish_curation_or_rebuild(publish, full_rebuild):
    """Use a full rebuild only when incremental publication is safely recoverable."""
    try:
        publish()
    except CurationRecoveryError:
        raise
    except CurationPublishError:
        full_rebuild()


def curation_readiness(value):
    """Describe whether a draft can be promoted to a reviewed guide."""
    try:
        normalized = build_route_curation(value or {})
    except ValueError as error:
        return {
            "status": "invalid",
            "complete": False,
            "missing_fields": [],
            "error": str(error),
        }

    missing = [field for field in REQUIRED_CURATION_FIELDS if field not in normalized]
    return {
        "status": normalized["review_status"],
        "complete": not missing,
        "missing_fields": missing,
        "error": None,
    }


def update_route_curation(config, activity_id, value):
    """Return a copied config with exactly one validated curation record changed."""
    normalized = build_route_curation(value)
    updated = copy.deepcopy(config)
    matching = [
        route for route in updated.get("routes", [])
        if str(route.get("activity_id")) == str(activity_id)
    ]
    if not matching:
        raise ValueError(f"route {activity_id} was not found")
    if len(matching) > 1:
        raise ValueError(f"route {activity_id} is duplicated")
    matching[0]["curation"] = normalized
    return updated


def save_curation_and_rebuild(config_path, activity_id, value, rebuild):
    """Persist one route, rebuild generated data, and roll back source on failure."""
    config_path = Path(config_path)
    recovery_path = config_path.with_name(f".{config_path.name}.rollback")
    original = config_path.read_text(encoding="utf-8")
    config = json.loads(original)
    updated = update_route_curation(config, activity_id, value)
    serialized = json.dumps(updated, indent=2) + "\n"

    write_atomic(recovery_path, original)
    try:
        write_atomic(config_path, serialized)
    except Exception:
        _unlink_best_effort(recovery_path)
        raise

    try:
        rebuild()
    except Exception as publication_error:
        try:
            replace_local_file(
                config_path.parent,
                ".",
                recovery_path.name,
                config_path.name,
            )
        except Exception as rollback_error:
            raise SourceRollbackError(
                f"publication failed: {publication_error}; "
                f"source rollback failed: {rollback_error}; "
                f"recovery copy: {recovery_path}",
                recovery_paths=[recovery_path],
            ) from rollback_error
        raise
    else:
        _unlink_best_effort(recovery_path)

    route = next(
        route for route in updated["routes"]
        if str(route.get("activity_id")) == str(activity_id)
    )
    return route


def write_atomic(path, content):
    """Replace a text file without exposing a partially written destination."""
    path = Path(path)
    write_local_text_atomic(path.parent, ".", path.name, content)


def _unlink_best_effort(path):
    try:
        path.unlink(missing_ok=True)
    except Exception:
        return
