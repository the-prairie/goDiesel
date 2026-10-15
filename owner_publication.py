"""Recoverable owner saves. Callers must serialize writers for one checkout.

Replacements are sequential, so readers can observe an intermediate version.
The journal supports process interruption recovery, not power-loss durability.
"""

import json
import fcntl
import os
import shutil
import tempfile
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path


JOURNAL_NAME = ".owner-publication-backup"
TOKEN_ENV = "GODIESEL_OWNER_PUBLICATION_TOKEN"
FD_ENV = "GODIESEL_OWNER_PUBLICATION_FD"
_active = threading.local()


class PublicationRecoveryError(RuntimeError):
    """Publication cannot proceed until the retained journal is recovered."""


def _targets(root, include_source):
    paths = [
        root / "app/public/data/routes",
        root / "app/src/data/quests.generated.json",
        root / "app/src/data/generated/routes.manifest.json",
        root / "app/src/data/generated/route-stats.json",
    ]
    return [root / "quests.json", *paths] if include_source else paths


def _discard_journal(journal):
    retired = journal.with_name(f"{JOURNAL_NAME}.cleanup-{uuid.uuid4().hex}")
    journal.rename(retired)
    shutil.rmtree(retired, ignore_errors=True)


def _restore(root, journal):
    if (journal / "committed").exists() or not (journal / "ready").exists():
        _discard_journal(journal)
        return
    entries = json.loads((journal / "entries.json").read_text(encoding="utf-8"))
    for index, entry in enumerate(entries):
        path = root / entry["path"]
        if not path.resolve().is_relative_to(root):
            raise PublicationRecoveryError("publication journal contains an outside path")
        backup = journal / str(index)
        if entry["kind"] == "directory":
            if path.exists():
                shutil.rmtree(path)
            shutil.copytree(backup, path)
        elif entry["kind"] == "file":
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(f".{path.name}.recovery")
            shutil.copy2(backup, temporary)
            os.replace(temporary, path)
        elif entry["kind"] == "missing":
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        else:
            raise PublicationRecoveryError("publication journal contains an unknown entry")
    generator_backup = root / "app/public/data/.route-generation-backup"
    if generator_backup.exists():
        shutil.rmtree(generator_backup)
    _discard_journal(journal)


def _same_lock(descriptor, path):
    try:
        inherited = os.fstat(int(descriptor))
        current = path.stat()
        return (inherited.st_dev, inherited.st_ino) == (current.st_dev, current.st_ino)
    except (OSError, TypeError, ValueError):
        return False


def recover_owner_publication(checkout_root, inherited_token=None, inherited_fd=None):
    """Restore an abandoned save before reading source or accepting mutations."""
    root = Path(checkout_root).resolve()
    if root in getattr(_active, "transactions", {}):
        return
    journal = root / JOURNAL_NAME
    if not journal.exists():
        return
    with (journal / "lock").open("rb") as lock:
        owner = json.loads((journal / "owner.json").read_text(encoding="utf-8"))
        if inherited_token == owner["token"] and _same_lock(inherited_fd, journal / "lock"):
            return
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise PublicationRecoveryError("another owner publication is still active") from error
        if not _same_lock(lock.fileno(), journal / "lock"):
            raise PublicationRecoveryError("publication journal changed; retry recovery")
        _restore(root, journal)


def owner_publication_subprocess_options(checkout_root):
    root = Path(checkout_root).resolve()
    transaction = getattr(_active, "transactions", {}).get(root)
    if transaction is None:
        raise RuntimeError("no active owner publication")
    return {
        "env": {**os.environ, TOKEN_ENV: transaction[0], FD_ENV: str(transaction[2])},
        "pass_fds": (transaction[2],),
    }


@contextmanager
def owner_publication(checkout_root, include_source=False):
    """Restore exact prior source/artifact bytes on failure, or retain recovery data."""
    root = Path(checkout_root).resolve()
    transactions = getattr(_active, "transactions", {})
    if root in transactions:
        if include_source and not transactions[root][1]:
            raise RuntimeError("cannot add source protection inside an artifact-only publication")
        yield
        return
    recover_owner_publication(root)
    if (root / "app/public/data/.route-generation-backup").exists():
        raise PublicationRecoveryError("generator recovery is required before an owner save")
    token = uuid.uuid4().hex
    journal = root / JOURNAL_NAME
    preparation = Path(tempfile.mkdtemp(prefix=".owner-publication-preparing-", dir=root))
    lock = (preparation / "lock").open("w+b")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (preparation / "owner.json").write_text(
            json.dumps({"pid": os.getpid(), "token": token}), encoding="utf-8"
        )
        preparation.rename(journal)
    except BaseException:
        lock.close()
        raise
    finally:
        if preparation.exists():
            shutil.rmtree(preparation)
    _active.transactions = {**transactions, root: (token, include_source, lock.fileno())}
    try:
        entries = []
        for index, path in enumerate(_targets(root, include_source)):
            kind = "directory" if path.is_dir() else "file" if path.exists() else "missing"
            entries.append({"path": str(path.relative_to(root)), "kind": kind})
            if kind == "directory":
                shutil.copytree(path, journal / str(index))
            elif kind == "file":
                shutil.copy2(path, journal / str(index))
        (journal / "entries.json").write_text(json.dumps(entries), encoding="utf-8")
        (journal / "ready").touch()
        yield
        (journal / "committed").touch()
    except BaseException:
        try:
            _restore(root, journal)
        except Exception as error:
            raise PublicationRecoveryError(
                f"publication recovery failed; retain {journal} and retry recovery"
            ) from error
        raise
    else:
        try:
            _discard_journal(journal)
        except OSError:
            pass
    finally:
        _active.transactions = transactions
        lock.close()
