"""Filesystem content-addressed storage for retained World Pack bytes."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from .canonical import sha256_bytes, sha256_file
from .errors import IntegrityError


@dataclass(frozen=True)
class ObjectRecord:
    sha256: str
    byteSize: int
    mediaType: str
    formatVersion: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


class ContentAddressedStore:
    """A SHA-256 store whose objects are immutable after admission."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.objects = self.root / "sha256"

    def object_path(self, digest: str) -> Path:
        if len(digest) != 64 or any(
            character not in "0123456789abcdef" for character in digest
        ):
            raise IntegrityError(f"invalid SHA-256 digest: {digest!r}")
        candidate = self.objects / digest[:2] / digest
        resolved_parent = candidate.parent.resolve()
        if not resolved_parent.is_relative_to(self.root):
            raise IntegrityError("content-addressed object path escapes its store")
        return candidate

    def admit(
        self,
        value: bytes,
        *,
        media_type: str,
        format_version: str,
    ) -> ObjectRecord:
        digest = sha256_bytes(value)
        target = self.object_path(digest)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            self._verify_path(target, digest, len(value))
        else:
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{digest}.", dir=target.parent
            )
            temporary = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(value)
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(temporary, 0o444)
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    self._verify_path(target, digest, len(value))
            finally:
                temporary.unlink(missing_ok=True)
        return ObjectRecord(digest, len(value), media_type, format_version)

    def admit_file(
        self,
        source: Path,
        *,
        media_type: str,
        format_version: str,
    ) -> ObjectRecord:
        if not source.is_file() or source.is_symlink():
            raise IntegrityError(f"source is not a regular file: {source}")
        incoming = self.root / ".incoming"
        incoming.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix="object.", dir=incoming)
        temporary = Path(temporary_name)
        digest = hashlib.sha256()
        byte_size = 0
        try:
            with source.open("rb") as input_file, os.fdopen(
                descriptor, "wb"
            ) as output_file:
                for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
                    digest.update(chunk)
                    byte_size += len(chunk)
                    output_file.write(chunk)
                output_file.flush()
                os.fsync(output_file.fileno())
            digest_value = digest.hexdigest()
            target = self.object_path(digest_value)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.chmod(temporary, 0o444)
            try:
                os.link(temporary, target)
            except FileExistsError:
                self._verify_path(target, digest_value, byte_size)
            return ObjectRecord(
                digest_value, byte_size, media_type, format_version
            )
        finally:
            temporary.unlink(missing_ok=True)

    def verify(self, record: ObjectRecord) -> None:
        self._verify_path(
            self.object_path(record.sha256), record.sha256, record.byteSize
        )

    def repair_file(
        self,
        source: Path,
        *,
        media_type: str,
        format_version: str,
    ) -> ObjectRecord:
        if not source.is_file() or source.is_symlink():
            raise IntegrityError(f"repair source is not a regular file: {source}")
        digest = sha256_file(source)
        byte_size = source.stat().st_size
        target = self.object_path(digest)
        if target.exists():
            try:
                self._verify_path(target, digest, byte_size)
                return ObjectRecord(digest, byte_size, media_type, format_version)
            except IntegrityError:
                quarantine = self.root / "quarantine" / f"{digest}.{uuid.uuid4().hex}"
                quarantine.parent.mkdir(parents=True, exist_ok=True)
                os.replace(target, quarantine)
        return self.admit_file(
            source, media_type=media_type, format_version=format_version
        )

    def read(self, record: ObjectRecord) -> bytes:
        self.verify(record)
        return self.object_path(record.sha256).read_bytes()

    def materialize(self, record: ObjectRecord, target: Path) -> None:
        self.verify(record)
        source = self.object_path(record.sha256)
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.", dir=target.parent
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            shutil.copyfile(source, temporary)
            os.chmod(temporary, 0o444)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _verify_path(path: Path, digest: str, byte_size: int) -> None:
        if not path.is_file() or path.is_symlink():
            raise IntegrityError(f"content object is not a regular file: {path}")
        actual_size = path.stat().st_size
        if actual_size != byte_size:
            raise IntegrityError(
                f"content object size mismatch for {digest}: {actual_size} != {byte_size}"
            )
        actual_digest = sha256_file(path)
        if actual_digest != digest:
            raise IntegrityError(
                f"content object digest mismatch: {actual_digest} != {digest}"
            )
