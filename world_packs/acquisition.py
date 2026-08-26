"""Provider-neutral acquisition contracts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Protocol

from .canonical import sha256_file, strict_json_load
from .errors import AcquisitionError, ValidationError
from .schema import validate_document


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
    lineage: dict[str, object] | None = None

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
        if result["lineage"] is None:
            del result["lineage"]
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


def _record(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise AcquisitionError(f"{label} is not an object")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AcquisitionError(f"{label} is missing")
    return value


def _custody_file(root: Path, filename: object, label: str) -> Path:
    value = _string(filename, f"{label} filename")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise AcquisitionError(f"{label} filename is not portable")
    path = root.joinpath(*relative.parts)
    if path.is_symlink() or not path.is_file():
        raise AcquisitionError(f"{label} is not a regular custody file: {path}")
    if not path.resolve().is_relative_to(root):
        raise AcquisitionError(f"{label} escapes the custody root")
    return path


def admit_source_receipt(
    receipt_path: Path, custody_root: Path
) -> tuple[AcquiredSource, ...]:
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise AcquisitionError(f"source receipt is not a regular file: {receipt_path}")
    receipt = _record(strict_json_load(receipt_path), "source receipt")
    try:
        validate_document("source-receipt", receipt)
    except ValidationError as error:
        raise AcquisitionError(f"source receipt is invalid: {error}") from error
    world_id = _string(receipt.get("worldId"), "source receipt worldId")
    acquired_at = _string(receipt.get("acquiredAt"), "source receipt acquiredAt")
    custody_root = custody_root.resolve()
    licence = _record(receipt.get("licence"), "source receipt licence")
    evidence = _custody_file(
        custody_root,
        licence.get("evidenceFilename"),
        "licence evidence",
    )
    evidence_digest = _string(
        licence.get("evidenceSha256"), "licence evidence checksum"
    )
    if sha256_file(evidence) != evidence_digest:
        raise AcquisitionError("licence evidence digest mismatch")
    raw_assets = receipt.get("assets")
    if not isinstance(raw_assets, list) or not raw_assets:
        raise AcquisitionError("source receipt assets are missing")
    result: list[AcquiredSource] = []
    names: set[str] = set()
    filenames: set[str] = set()
    for index, raw_asset in enumerate(raw_assets):
        asset = _record(raw_asset, f"source receipt asset {index}")
        logical_name = _string(asset.get("logicalName"), "asset logicalName")
        filename = _string(asset.get("filename"), "asset filename")
        if logical_name in names or filename in filenames:
            raise AcquisitionError("source receipt assets are not unique")
        names.add(logical_name)
        filenames.add(filename)
        path = _custody_file(custody_root, filename, f"source asset {logical_name}")
        byte_size = asset.get("byteSize")
        if isinstance(byte_size, bool) or not isinstance(byte_size, int):
            raise AcquisitionError(f"source asset {logical_name} byte size is invalid")
        if path.stat().st_size != byte_size:
            raise AcquisitionError(f"source asset {logical_name} size mismatch")
        expected_digest = _string(asset.get("sha256"), "asset checksum")
        if sha256_file(path) != expected_digest:
            raise AcquisitionError(f"source asset {logical_name} digest mismatch")
        obligations = licence.get("publicUseObligations")
        if not isinstance(obligations, list) or any(
            not isinstance(value, str) for value in obligations
        ):
            raise AcquisitionError("source receipt obligations are invalid")
        source = AcquiredSource(
            logical_name=logical_name,
            path=path,
            media_type=_string(asset.get("mediaType"), "asset mediaType"),
            format_version=_string(
                asset.get("formatVersion"), "asset formatVersion"
            ),
            evidence_class=_string(
                asset.get("evidenceClass"), "asset evidenceClass"
            ),
            source_uri=_string(asset.get("sourceUri"), "asset sourceUri"),
            source_version=_string(
                asset.get("sourceVersion"), "asset sourceVersion"
            ),
            acquired_at=acquired_at,
            source_date=(
                _string(asset.get("sourceDate"), "asset sourceDate")
                if asset.get("sourceDate") is not None
                else None
            ),
            licence_id=_string(licence.get("id"), "licence id"),
            licence_uri=_string(licence.get("uri"), "licence uri"),
            licence_evidence_sha256=evidence_digest,
            attribution=_string(licence.get("attribution"), "licence attribution"),
            retention_allowed=licence.get("retentionAllowed") is True,
            derivatives_allowed=licence.get("derivativesAllowed") is True,
            redistribution=_string(
                licence.get("redistribution"), "licence redistribution"
            ),
            public_use_obligations=tuple(obligations),
            third_party_rights=_string(
                licence.get("thirdPartyRights"), "licence thirdPartyRights"
            ),
            decision=_string(licence.get("decision"), "licence decision"),
            decision_reason=_string(
                licence.get("decisionReason"), "licence decisionReason"
            ),
            adapter=_string(asset.get("adapter"), "asset adapter"),
            adapter_version=_string(
                asset.get("adapterVersion"), "asset adapterVersion"
            ),
            lineage=(
                dict(_record(asset.get("lineage"), "asset lineage"))
                if asset.get("lineage") is not None
                else None
            ),
        )
        source.public_pack_metadata()
        result.append(source)
    return tuple(result)
