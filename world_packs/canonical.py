"""Canonical JSON, strict parsing, and content identity helpers."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import rfc8785

from .errors import ValidationError


def canonical_json_bytes(value: object) -> bytes:
    """Serialize a JSON-compatible value with RFC 8785 JCS."""
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, TypeError, ValueError) as error:
        raise ValidationError(f"value is not RFC 8785 canonicalizable: {error}") from error


def canonical_json_document(value: object) -> bytes:
    """Return canonical JSON with one non-identity trailing newline."""
    return canonical_json_bytes(value) + b"\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"JSON object contains duplicate key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValidationError(f"JSON contains non-finite number: {value}")


def strict_json_loads(value: str | bytes) -> object:
    try:
        return json.loads(
            value,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_constant,
        )
    except ValidationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"invalid JSON: {error}") from error


def strict_json_load(path: Path) -> object:
    return strict_json_loads(path.read_bytes())
