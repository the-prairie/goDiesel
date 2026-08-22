"""One-route compilation boundary shared by Studio staging and build.py."""

import hashlib
import json

from route_compiler import RouteCompilationInput, compile_route_contract
from route_provenance import SourceRoutePoint


def compile_route(candidate, metadata, receipt):
    points = []
    recorded_timing = candidate.timing_status == "recorded"
    for segment_index, segment in enumerate(candidate.segments):
        points.extend(SourceRoutePoint(
            lat=point.lat,
            lng=point.lng,
            elevation=point.elevation if point.elevation is not None else 0.0,
            timestamp=point.timestamp if recorded_timing else None,
            segment_index=segment_index,
        ) for point in segment)
    lifecycle = "completed" if metadata["completed_by_owner"] else "discovered"
    route_id = f"route-{candidate.geometry_fingerprint[:12]}"
    detail = compile_route_contract(RouteCompilationInput(
        route_id=route_id,
        activity_id=None,
        identity_kind="imported-route",
        source_kind="owner-import",
        source_format=receipt["detected_format"],
        activity_name=metadata["name"],
        activity_type=metadata["activity_type"],
        date=metadata["date"],
        description="",
        region=metadata["region"],
        lifecycle=lifecycle,
        source_points=tuple(points),
        spec={},
        elevation_status=candidate.elevation_status,
    ))
    detail.update({
        "curation": {"review_status": "draft"},
        "annotations": [],
        "privacy": metadata["privacy"],
        "source_receipt": receipt,
    })
    fingerprint = hashlib.sha256(
        json.dumps(detail, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return detail, fingerprint
