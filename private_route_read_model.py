"""Owner-only route details rebuilt from canonical private source evidence."""

import json
from pathlib import Path

from route_compiler import RouteCompilationInput, compile_route_contract
from route_imports import route_identity, route_metadata, route_source_format
from route_provenance import load_source_route_points


def private_owner_routes(
    checkout_root: Path,
    *,
    durable_source_root: Path,
) -> list[dict[str, object]]:
    root = Path(checkout_root).resolve()
    config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    details = []
    for spec in config.get("routes", []):
        if not _is_private_owner_route(spec):
            continue
        route_id, activity_id, identity_kind = route_identity(spec)
        metadata = route_metadata(
            spec,
            root,
            durable_source_root=durable_source_root,
        )
        if metadata is None or metadata.source_path is None:
            raise ValueError(f"private route {route_id} has no canonical source")
        detail = compile_route_contract(RouteCompilationInput(
            route_id=route_id,
            activity_id=activity_id,
            identity_kind=identity_kind,
            source_kind=metadata.source_kind,
            source_format=route_source_format(spec, metadata.source_path),
            activity_name=metadata.name,
            activity_type=metadata.activity_type,
            date=metadata.date,
            description=metadata.description,
            region=str(spec.get("region") or "Unknown region"),
            lifecycle=str(spec.get("lifecycle") or "completed"),
            source_points=tuple(load_source_route_points(metadata.source_path)),
            spec=spec,
            elevation_status=str(spec.get("elevation_status") or "recorded"),
        ))
        detail.setdefault("curation", {"review_status": "draft"})
        detail.setdefault("annotations", [])
        details.append(detail)
    return sorted(details, key=lambda route: str(route["slug"]))


def _is_private_owner_route(spec: object) -> bool:
    return (
        isinstance(spec, dict)
        and spec.get("status") == "approved"
        and spec.get("visibility") == "hidden"
        and spec.get("source_kind") == "owner-import"
    )
