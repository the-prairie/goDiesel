"""Owner-only local route export discovery for Route Studio."""

from datetime import UTC, datetime
import hashlib
import heapq
import os
from pathlib import Path
import stat

from route_studio_importers import MAX_SOURCE_BYTES


SUPPORTED_SUFFIXES = frozenset((".gpx", ".kml", ".kmz"))
MAX_VISIBLE_ENTRIES = 200
MAX_SCAN_BYTES = 64 * 1024 * 1024


class RouteInbox:
    def __init__(self, studio, roots):
        self.studio = studio
        canonical_roots = (_canonical_root(root) for root in roots)
        self.roots = tuple(dict.fromkeys(canonical_roots))

    def list_entries(self):
        candidates, warnings = self._candidates()
        candidates = sorted(
            candidates,
            key=lambda candidate: (
                candidate["source_stat"].st_mtime_ns,
                candidate["filename"],
            ),
            reverse=True,
        )
        entries = []
        remaining_bytes = MAX_SCAN_BYTES
        for candidate in candidates:
            may_read = (
                candidate["eligible"]
                and candidate["source_stat"].st_size <= remaining_bytes
            )
            entry, payload = self._materialize(
                candidate,
                warnings,
                max_read_bytes=remaining_bytes if may_read else 0,
            )
            if entry is not None:
                entries.append(entry)
            if payload is not None:
                remaining_bytes -= len(payload)
            elif may_read:
                remaining_bytes = 0
        return {
            "roots": [str(root) for root in self.roots],
            "entries": entries,
            "warnings": warnings,
        }

    def import_entry(self, entry_id):
        matches, warnings = self._matching_candidates(entry_id)
        if len(matches) != 1:
            raise ValueError("route inbox entry was not found")
        entry, payload = self._materialize(
            matches[0], warnings, max_read_bytes=MAX_SOURCE_BYTES
        )
        if entry is None:
            raise ValueError("route inbox entry was not found")
        if not entry["eligible"]:
            raise ValueError(f'route inbox entry is not eligible: {entry["reason"]}')
        if payload is None:
            raise ValueError("route inbox entry was not found")
        return self.studio.upload(entry["filename"], payload)

    def _candidates(self):
        found = []
        sequence = 0
        warnings = []
        for root in self.roots:
            try:
                directory_fd = _open_directory(root)
            except OSError:
                _warn(warnings, f"Route inbox folder is unavailable: {root}")
                continue
            try:
                with os.scandir(directory_fd) as directory:
                    for directory_entry in directory:
                        source_format = _source_format(directory_entry.name)
                        if source_format is None:
                            continue
                        try:
                            source_stat = directory_entry.stat(follow_symlinks=False)
                        except OSError:
                            _warn(
                                warnings,
                                f"Route inbox file became unavailable: {directory_entry.name}",
                            )
                            continue
                        if not stat.S_ISREG(source_stat.st_mode):
                            continue
                        eligible, reason = _eligibility(
                            directory_entry.name, source_stat.st_size
                        )
                        candidate = {
                            "id": _entry_id(root, directory_entry.name),
                            "root": root,
                            "filename": directory_entry.name,
                            "source_format": source_format,
                            "source_stat": source_stat,
                            "eligible": eligible,
                            "reason": reason,
                        }
                        key = (
                            source_stat.st_mtime_ns,
                            directory_entry.name,
                            sequence,
                            candidate,
                        )
                        sequence += 1
                        if len(found) < MAX_VISIBLE_ENTRIES:
                            heapq.heappush(found, key)
                        else:
                            heapq.heappushpop(found, key)
            except OSError:
                _warn(warnings, f"Route inbox folder is unavailable: {root}")
            finally:
                os.close(directory_fd)
        return [item[3] for item in found], warnings

    def _matching_candidates(self, entry_id):
        matches = []
        warnings = []
        for root in self.roots:
            try:
                directory_fd = _open_directory(root)
            except OSError:
                _warn(warnings, f"Route inbox folder is unavailable: {root}")
                continue
            try:
                with os.scandir(directory_fd) as directory:
                    for directory_entry in directory:
                        if _entry_id(root, directory_entry.name) != entry_id:
                            continue
                        source_format = _source_format(directory_entry.name)
                        if source_format is None:
                            continue
                        try:
                            source_stat = directory_entry.stat(follow_symlinks=False)
                        except OSError:
                            continue
                        if not stat.S_ISREG(source_stat.st_mode):
                            continue
                        eligible, reason = _eligibility(
                            directory_entry.name, source_stat.st_size
                        )
                        matches.append({
                            "id": entry_id,
                            "root": root,
                            "filename": directory_entry.name,
                            "source_format": source_format,
                            "source_stat": source_stat,
                            "eligible": eligible,
                            "reason": reason,
                        })
            finally:
                os.close(directory_fd)
        return matches, warnings

    def _materialize(self, candidate, warnings, max_read_bytes):
        eligible = candidate["eligible"]
        reason = candidate["reason"]
        source_stat = candidate["source_stat"]
        payload = None
        checksum_status = "checked"
        if eligible and max_read_bytes <= 0:
            checksum_status = "deferred"
        elif eligible:
            try:
                directory_fd = _open_directory(candidate["root"])
                try:
                    payload, source_stat = _read_source(
                        directory_fd,
                        candidate["filename"],
                        max_read_bytes=max_read_bytes,
                    )
                finally:
                    os.close(directory_fd)
            except SourceTooLarge as error:
                source_stat = error.source_stat
                eligible = False
                reason = "Source exceeds the 25 MiB limit."
            except SourceChanged as error:
                source_stat = error.source_stat
                eligible = False
                reason = "Source changed during the scan. Refresh to retry."
            except ChecksumDeferred as error:
                source_stat = error.source_stat
                checksum_status = "deferred"
            except OSError:
                _warn(
                    warnings,
                    f'Route inbox file became unavailable: {candidate["filename"]}',
                )
                return None, None
        job_id = (
            self.studio.job_for_source_sha(hashlib.sha256(payload).hexdigest())
            if payload is not None
            else None
        )
        return ({
            "id": candidate["id"],
            "filename": candidate["filename"],
            "source_format": candidate["source_format"],
            "size_bytes": source_stat.st_size,
            "modified_at": datetime.fromtimestamp(
                source_stat.st_mtime, tz=UTC
            ).isoformat().replace("+00:00", "Z"),
            "eligible": eligible,
            "reason": reason,
            "imported": job_id is not None,
            "job_id": job_id,
            "checksum_status": checksum_status,
        }, payload)


class SourceTooLarge(Exception):
    def __init__(self, source_stat):
        super().__init__("source exceeds the Route Studio size limit")
        self.source_stat = source_stat


class SourceChanged(Exception):
    def __init__(self, source_stat):
        super().__init__("source changed during the Route Studio scan")
        self.source_stat = source_stat


class ChecksumDeferred(Exception):
    def __init__(self, source_stat):
        super().__init__("source checksum was deferred by the scan budget")
        self.source_stat = source_stat


def _canonical_root(root):
    return Path(os.path.abspath(os.fspath(Path(root).expanduser())))


def _open_directory(root):
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    directory_fd = os.open(root.anchor, flags)
    try:
        for component in root.parts[1:]:
            child_fd = os.open(component, flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
        return directory_fd
    except BaseException:
        os.close(directory_fd)
        raise


def _read_source(directory_fd, filename, max_read_bytes=MAX_SOURCE_BYTES):
    source_fd = os.open(
        filename,
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        dir_fd=directory_fd,
    )
    with os.fdopen(source_fd, "rb") as source_file:
        before = os.fstat(source_file.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise OSError("route inbox source is not a regular file")
        if before.st_size > MAX_SOURCE_BYTES:
            raise SourceTooLarge(before)
        if before.st_size > max_read_bytes:
            raise ChecksumDeferred(before)
        payload = source_file.read(min(MAX_SOURCE_BYTES, max_read_bytes) + 1)
        after = os.fstat(source_file.fileno())
        if len(payload) > MAX_SOURCE_BYTES or after.st_size > MAX_SOURCE_BYTES:
            raise SourceTooLarge(after)
        if len(payload) > max_read_bytes or after.st_size > max_read_bytes:
            raise ChecksumDeferred(after)
        if len(payload) != before.st_size or _stat_identity(before) != _stat_identity(after):
            raise SourceChanged(after)
        return payload, after


def _stat_identity(source_stat):
    return (
        source_stat.st_dev,
        source_stat.st_ino,
        source_stat.st_size,
        source_stat.st_mtime_ns,
        source_stat.st_ctime_ns,
    )


def _warn(warnings, message):
    if message not in warnings:
        warnings.append(message)


def route_inbox_origin_allowed(headers, allowed_origins):
    origin = headers.get("Origin")
    return origin is not None and origin in allowed_origins


def _entry_id(root, filename):
    identity = f"{root}\0{filename}".encode("utf-8")
    return hashlib.sha256(identity).hexdigest()[:24]


def _source_format(filename):
    lower = filename.lower()
    if lower.endswith(".fit.gz") or lower.endswith(".fit"):
        return "fit"
    suffix = Path(lower).suffix
    return suffix[1:] if suffix in SUPPORTED_SUFFIXES else None


def _eligibility(filename, size_bytes):
    lower = filename.lower()
    if lower.endswith((".fit", ".fit.gz")):
        return False, "Route Studio needs a GPX export for FIT/FIT.GZ sources."
    if size_bytes > MAX_SOURCE_BYTES:
        return False, "Source exceeds the 25 MiB limit."
    return True, None
