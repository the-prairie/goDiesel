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
    acquired_at: str
    source_date: str | None
    licence: str
    attribution: str
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
            "acquired_at": self.acquired_at,
            "licence": self.licence,
            "attribution": self.attribution,
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

    def metadata(self) -> dict[str, object]:
        result = asdict(self)
        del result["path"]
        return result


class AcquisitionAdapter(Protocol):
    name: str
    version: str

    def acquire(self, request: AcquisitionRequest) -> Iterable[AcquiredSource]: ...
