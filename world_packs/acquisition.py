"""Provider-neutral acquisition contracts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Protocol

from .errors import AcquisitionError


EVIDENCE_CLASSES = {
    "recorded",
    "derived",
    "measured",
    "reconstructed",
    "procedural",
    "unavailable",
}
REDISTRIBUTION_DECISIONS = {"allowed", "restricted", "private_only", "unknown"}
ADMISSION_DECISIONS = {"admit", "private_pack_only", "metadata_only", "reject"}


@dataclass(frozen=True)
class AcquisitionRequest:
    world_id: str
    corridor_bounds: tuple[float, float, float, float]
    quality: str


@dataclass(frozen=True)
class AcquiredSource:
    logical_name: str
    path: Path
    media_type: str
    format_version: str
    evidence_class: str
    source_uri: str
    source_version: str
    acquired_at: str
    source_date: str | None
    licence_id: str
    licence_uri: str
    licence_evidence_sha256: str
    attribution: str
    retention_allowed: bool
    derivatives_allowed: bool
    redistribution: str
    public_use_obligations: tuple[str, ...]
    third_party_rights: str
    decision: str
    decision_reason: str
    adapter: str
    adapter_version: str

    def __post_init__(self) -> None:
        if self.evidence_class not in EVIDENCE_CLASSES - {"unavailable"}:
            raise AcquisitionError(
                f"source {self.logical_name!r} has invalid evidence class"
            )
        required = {
            "logical_name": self.logical_name,
            "media_type": self.media_type,
            "format_version": self.format_version,
            "source_uri": self.source_uri,
            "source_version": self.source_version,
            "acquired_at": self.acquired_at,
            "licence_id": self.licence_id,
            "licence_uri": self.licence_uri,
            "attribution": self.attribution,
            "third_party_rights": self.third_party_rights,
            "decision_reason": self.decision_reason,
            "adapter": self.adapter,
            "adapter_version": self.adapter_version,
        }
        missing = [name for name, value in required.items() if not value.strip()]
        if missing:
            raise AcquisitionError(
                f"source {self.logical_name!r} is missing: {', '.join(missing)}"
            )
        if not self.path.is_file() or self.path.is_symlink():
            raise AcquisitionError(f"source is not a regular file: {self.path}")
        if (
            len(self.licence_evidence_sha256) != 64
            or any(
                character not in "0123456789abcdef"
                for character in self.licence_evidence_sha256
            )
        ):
            raise AcquisitionError(
                f"source {self.logical_name!r} has invalid licence evidence checksum"
            )
        if self.redistribution not in REDISTRIBUTION_DECISIONS:
            raise AcquisitionError(
                f"source {self.logical_name!r} has invalid redistribution decision"
            )
        if self.decision not in ADMISSION_DECISIONS:
            raise AcquisitionError(
                f"source {self.logical_name!r} has invalid admission decision"
            )
        if not self.public_use_obligations or any(
            not obligation.strip() for obligation in self.public_use_obligations
        ):
            raise AcquisitionError(
                f"source {self.logical_name!r} has invalid public-use obligations"
            )

    def metadata(self) -> dict[str, object]:
        result = asdict(self)
        del result["path"]
        result["public_use_obligations"] = list(self.public_use_obligations)
        return result

    def public_pack_metadata(self) -> dict[str, object]:
        if self.decision != "admit":
            raise AcquisitionError(
                f"source {self.logical_name!r} decision is not admit"
            )
        if not self.retention_allowed:
            raise AcquisitionError(
                f"source {self.logical_name!r} retention is not allowed"
            )
        if not self.derivatives_allowed:
            raise AcquisitionError(
                f"source {self.logical_name!r} derivatives are not allowed"
            )
        if self.redistribution != "allowed":
            raise AcquisitionError(
                f"source {self.logical_name!r} redistribution is not allowed"
            )
        return self.metadata()


class AcquisitionAdapter(Protocol):
    name: str
    version: str

    def acquire(self, request: AcquisitionRequest) -> Iterable[AcquiredSource]: ...
