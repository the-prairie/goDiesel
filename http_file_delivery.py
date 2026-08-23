"""Bounded HTTP delivery for local Route Studio film artifacts.

The owner server intentionally supports only one byte range. Malformed and
multipart Range headers fall back to a normal streamed 200 response; a
well-formed but impossible single range produces 416.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import BinaryIO, Callable, Mapping, Protocol

FILE_CHUNK_BYTES = 1024 * 1024
_BYTE_RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")
_DISCONNECT_ERRORS = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)


class UnsatisfiableRange(ValueError):
    """A syntactically valid single byte range cannot select this file."""


class ArtifactNotFound(ValueError):
    """The requested artifact is not present in the job's exact allowlist."""


class ResponseHandler(Protocol):
    headers: Mapping[str, str]
    wfile: BinaryIO

    def send_response(self, code: int, message: str | None = None) -> None: ...

    def send_header(self, keyword: str, value: str) -> None: ...

    def end_headers(self) -> None: ...


def parse_single_byte_range(
    value: str | None,
    file_size: int,
) -> tuple[int, int] | None:
    """Parse one RFC-style bytes range and return inclusive ``(start, end)``.

    Missing, malformed, or multipart values return ``None`` so callers serve a
    normal streamed 200 response. Valid-but-impossible single ranges raise
    ``UnsatisfiableRange`` and map to HTTP 416.
    """

    if file_size < 0:
        raise ValueError("file_size must be non-negative")
    if value is None:
        return None

    normalized = value.strip()
    if "," in normalized:
        return None
    match = _BYTE_RANGE_PATTERN.fullmatch(normalized)
    if match is None:
        return None

    first, last = match.groups()
    if not first and not last:
        return None
    if file_size == 0:
        raise UnsatisfiableRange("an empty file has no satisfiable byte range")

    if first:
        start = int(first)
        if start >= file_size:
            raise UnsatisfiableRange("range starts beyond the end of the file")
        end = file_size - 1 if not last else min(int(last), file_size - 1)
        if end < start:
            raise UnsatisfiableRange("range end precedes range start")
        return start, end

    suffix_length = int(last)
    if suffix_length <= 0:
        raise UnsatisfiableRange("suffix range must request at least one byte")
    return max(file_size - suffix_length, 0), file_size - 1


def resolve_studio_artifact(
    checkout_root: Path,
    job: Mapping[str, object],
    job_id: str,
    filename: str,
) -> tuple[Path, Mapping[str, object]]:
    """Apply Route Studio's exact artifact allowlist and containment checks."""

    expected = f".route-studio/artifacts/{job_id}/{filename}"
    artifacts = job.get("artifacts", [])
    artifact = next(
        (
            item
            for item in artifacts
            if isinstance(item, Mapping) and item.get("path") == expected
        ),
        None,
    )
    if artifact is None:
        raise ArtifactNotFound("Studio artifact was not found")

    artifact_path = (checkout_root / expected).resolve()
    artifact_root = (checkout_root / ".route-studio" / "artifacts" / job_id).resolve()
    if artifact_path.parent != artifact_root or not artifact_path.is_file():
        raise ArtifactNotFound("Studio artifact was not found")
    return artifact_path, artifact


def stream_bytes(
    source: BinaryIO,
    destination: BinaryIO,
    *,
    start: int,
    length: int,
    chunk_size: int = FILE_CHUNK_BYTES,
) -> int:
    """Write at most ``length`` bytes from one open descriptor in bounded reads."""

    if start < 0 or length < 0:
        raise ValueError("start and length must be non-negative")
    if chunk_size < 1:
        raise ValueError("chunk_size must be positive")

    source.seek(start)
    remaining = length
    written = 0
    try:
        while remaining:
            chunk = source.read(min(chunk_size, remaining))
            if not chunk:
                break
            destination.write(chunk)
            written += len(chunk)
            remaining -= len(chunk)
    except _DISCONNECT_ERRORS:
        # A media element normally abandons an earlier request when the owner
        # seeks. That is not a server failure and must not emit a traceback.
        return written
    return written


def serve_file(
    handler: ResponseHandler,
    path: Path,
    *,
    content_type: str,
    add_cors_headers: Callable[[tuple[str, ...]], None],
    etag_sha256: str | None = None,
    head_only: bool = False,
    chunk_size: int = FILE_CHUNK_BYTES,
) -> None:
    """Serve one file as a bounded 200/206/416 response.

    The file is opened once and sized from that descriptor. A HEAD request uses
    the same file and authorization path but deliberately ignores Range and
    returns full-representation metadata with no body.
    """

    with path.open("rb") as source:
        file_size = os.fstat(source.fileno()).st_size
        selected_range: tuple[int, int] | None = None
        if not head_only:
            try:
                selected_range = parse_single_byte_range(
                    handler.headers.get("Range"),
                    file_size,
                )
            except UnsatisfiableRange:
                _send_file_headers(
                    handler,
                    status=416,
                    content_type=content_type,
                    content_length=0,
                    content_range=f"bytes */{file_size}",
                    filename=path.name,
                    add_cors_headers=add_cors_headers,
                    etag_sha256=etag_sha256,
                )
                return

        if selected_range is None:
            status = 200
            start = 0
            length = file_size
            content_range = None
        else:
            status = 206
            start, end = selected_range
            length = end - start + 1
            content_range = f"bytes {start}-{end}/{file_size}"

        _send_file_headers(
            handler,
            status=status,
            content_type=content_type,
            content_length=length,
            content_range=content_range,
            filename=path.name,
            add_cors_headers=add_cors_headers,
            etag_sha256=etag_sha256,
        )
        if not head_only and length:
            stream_bytes(
                source,
                handler.wfile,
                start=start,
                length=length,
                chunk_size=chunk_size,
            )


def _send_file_headers(
    handler: ResponseHandler,
    *,
    status: int,
    content_type: str,
    content_length: int,
    content_range: str | None,
    filename: str,
    add_cors_headers: Callable[[tuple[str, ...]], None],
    etag_sha256: str | None,
) -> None:
    safe_filename = filename.replace("\\", "_").replace('"', "'").replace("\r", "").replace("\n", "")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(content_length))
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Cache-Control", "private, no-store")
    handler.send_header("Content-Disposition", f'inline; filename="{safe_filename}"')
    handler.send_header("X-Content-Type-Options", "nosniff")
    if content_range is not None:
        handler.send_header("Content-Range", content_range)
    if etag_sha256:
        handler.send_header("ETag", f'"sha256-{etag_sha256}"')
    add_cors_headers(("Accept-Ranges", "Content-Range", "Content-Length", "ETag"))
    handler.end_headers()
