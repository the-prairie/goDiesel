"""Auditable, real-source verification for the goDiesel release pipeline."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import warnings
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image

from route_provenance import build_route_provenance, load_source_route_points


ROOT = Path(__file__).resolve().parent
DEFAULT_DIESEL_DIARIES = Path("/Users/laurenzary/Desktop/DieselDiaries")
OUTPUT_REQUIRED_FIELDS = frozenset(
    {
        "activity_id",
        "activity_name",
        "center_lat",
        "center_lng",
        "completion_rule",
        "date",
        "description",
        "difficulty",
        "distance_km",
        "elevation_gain_m",
        "lifecycle",
        "mid_idx",
        "name",
        "provenance",
        "region",
        "replay",
        "route",
        "slug",
        "subtitle",
        "theme",
        "type",
        "xp",
    }
)
MATRIX_CASES = (
    {
        "slug": "17654151284",
        "covers": ("run", "earth", "recorded", "reviewed", "curated"),
    },
    {
        "slug": "9934715694",
        "covers": ("ride", "earth", "recorded", "mountain"),
    },
    {
        "slug": "9845102380",
        "covers": ("ride", "atlas", "recorded", "regional-terrain"),
    },
    {
        "slug": "14736711660",
        "covers": ("run", "atlas", "recorded", "urban", "coarse-mesh"),
    },
    {
        "slug": "3519505225411091950",
        "covers": ("run", "atlas", "imported-gpx", "discovered", "draft"),
    },
)
def build_files():
    """Every top-level Python module, plus the source of truth.

    A hand-kept list rots. route_annotations.py had to be added here after a
    rebuild in an isolated workspace failed with ModuleNotFoundError, and the
    same list in app/e2e/live-pipeline.spec.ts failed the live gate the same
    way. Derive it so adding a module cannot break the proof.
    """
    modules = sorted(
        path.name
        for path in Path(__file__).resolve().parent.glob("*.py")
        if not path.name.startswith("test_")
    )
    return (*modules, "quests.json")


class VerificationError(RuntimeError):
    """Raised when a proof cannot be established from the real inputs."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )


def approved_specs(root: Path) -> list[dict[str, Any]]:
    payload = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    routes = payload.get("routes", payload.get("quests", []))
    specs = [
        route
        for route in routes
        if route.get("status", "approved") == "approved"
        and route.get("visibility", "public") != "hidden"
    ]
    activity_ids = [str(route.get("activity_id", "")) for route in specs]
    if any(not activity_id for activity_id in activity_ids):
        raise VerificationError("approved route is missing an activity_id")
    if len(activity_ids) != len(set(activity_ids)):
        raise VerificationError("approved routes contain duplicate activity ids")
    return specs


def unique_routes_by_slug(records: Any, label: str) -> dict[str, dict[str, Any]]:
    if not isinstance(records, list):
        raise VerificationError(f"{label} routes must be a list")
    indexed: dict[str, dict[str, Any]] = {}
    for index, route in enumerate(records):
        if not isinstance(route, dict) or not route.get("slug"):
            raise VerificationError(f"{label} route {index} has no slug")
        slug = str(route["slug"])
        if slug in indexed:
            raise VerificationError(f"{label} routes contain duplicate slug {slug}")
        indexed[slug] = route
    return indexed


def activity_rows(
    diesel_diaries: Path,
) -> tuple[list[str], list[list[str]], dict[str, list[str]]]:
    path = diesel_diaries / "activities.csv"
    if not path.is_file():
        raise VerificationError(f"missing real Strava activity export: {path}")
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.reader(source)
        try:
            headers = next(reader)
        except StopIteration as error:
            raise VerificationError("Strava activity export is empty") from error
        try:
            filename_index = headers.index("Filename")
        except ValueError as error:
            raise VerificationError("Strava activity export has no Filename column") from error
        by_id: dict[str, list[str]] = {}
        rows: list[list[str]] = []
        for row in reader:
            rows.append(row)
            if len(row) != len(headers):
                raise VerificationError(
                    f"activities.csv row {len(rows) + 1} has {len(row)} cells; expected {len(headers)}"
                )
            match = re.match(r".*?/(\d+)", row[filename_index])
            if match:
                activity_id = match.group(1)
                if activity_id in by_id:
                    raise VerificationError(
                        f"activities.csv contains duplicate activity id {activity_id}"
                    )
                by_id[activity_id] = row
    return headers, rows, by_id


def source_file_for(
    spec: dict[str, Any], root: Path, diesel_diaries: Path
) -> tuple[Path, str]:
    source_gpx = spec.get("source_gpx")
    if source_gpx:
        path = (root / str(source_gpx)).resolve()
        if not path.is_relative_to((root / "route_sources").resolve()):
            raise VerificationError(f"imported route escaped route_sources: {source_gpx}")
        return path, "imported-gpx"
    activity_id = str(spec["activity_id"])
    base = diesel_diaries / "strava_export" / "activities"
    for suffix in (".gpx", ".fit.gz", ".fit"):
        candidate = base / f"{activity_id}{suffix}"
        if candidate.is_file():
            return candidate, "strava-export"
    raise VerificationError(f"missing original GPX/FIT source for approved route {activity_id}")


def field_inventory(value: Any, prefix: str = "") -> Counter[tuple[str, str]]:
    inventory: Counter[tuple[str, str]] = Counter()
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else key
            inventory.update(field_inventory(child, path))
    elif isinstance(value, list):
        inventory[(f"{prefix}[]", "array")] += 1
        for child in value:
            inventory.update(field_inventory(child, f"{prefix}[]"))
    else:
        if isinstance(value, float) and not math.isfinite(value):
            raise VerificationError(f"non-finite numeric output at {prefix}")
        inventory[(prefix, type(value).__name__)] += 1
    return inventory


def normalized_generated(path: Path) -> Any:
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, dict):
        value.pop("generated_at", None)
    return value


def compare_regeneration(root: Path, python: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="godiesel-real-pipeline-") as directory:
        workspace = Path(directory)
        for relative in build_files():
            shutil.copy2(root / relative, workspace / relative)
        shutil.copytree(root / "route_sources", workspace / "route_sources")
        (workspace / "app/src/data/generated").mkdir(parents=True)
        (workspace / "app/public/data/routes").mkdir(parents=True)

        result = subprocess.run(
            [str(python), "build.py"],
            cwd=workspace,
            check=False,
            capture_output=True,
            text=True,
            timeout=900,
        )
        if result.returncode != 0:
            raise VerificationError(
                "real-source regeneration failed:\n" + (result.stderr or result.stdout)[-4000:]
            )

        compared = (
            "app/src/data/quests.generated.json",
            "app/src/data/generated/routes.manifest.json",
            "app/src/data/generated/route-stats.json",
        )
        mismatches = [
            relative
            for relative in compared
            if normalized_generated(workspace / relative) != normalized_generated(root / relative)
        ]
        expected_details = workspace / "app/public/data/routes"
        actual_details = root / "app/public/data/routes"
        expected_names = sorted(path.name for path in expected_details.glob("*.json"))
        actual_names = sorted(path.name for path in actual_details.glob("*.json"))
        if expected_names != actual_names:
            mismatches.append("app/public/data/routes file set")
        else:
            for name in expected_names:
                if json.loads((expected_details / name).read_text()) != json.loads(
                    (actual_details / name).read_text()
                ):
                    mismatches.append(f"app/public/data/routes/{name}")
        if mismatches:
            raise VerificationError(
                "committed generated data differs from a fresh real-source build: "
                + ", ".join(mismatches[:20])
            )

        return {
            "workspace_kind": "isolated-temporary-copy",
            "build_exit_code": result.returncode,
            "compared_artifacts": [*compared, "app/public/data/routes/*.json"],
            "detail_files": len(expected_names),
        }


def verify_real_pipeline(
    root: Path = ROOT,
    diesel_diaries: Path = DEFAULT_DIESEL_DIARIES,
    *,
    rebuild: bool = False,
    python: Path | None = None,
) -> dict[str, Any]:
    specs = approved_specs(root)
    headers, activity_data_rows, rows_by_id = activity_rows(diesel_diaries)
    generated = json.loads(
        (root / "app/src/data/quests.generated.json").read_text(encoding="utf-8")
    )
    manifest = json.loads(
        (root / "app/src/data/generated/routes.manifest.json").read_text(encoding="utf-8")
    )
    generated_by_slug = unique_routes_by_slug(generated.get("routes"), "generated")
    manifest_by_slug = unique_routes_by_slug(manifest.get("routes"), "manifest")
    approved_ids = {str(spec["activity_id"]) for spec in specs}
    detail_dir = root / "app/public/data/routes"
    detail_ids = {path.stem for path in detail_dir.glob("*.json")}
    if approved_ids != set(generated_by_slug) or approved_ids != set(manifest_by_slug):
        raise VerificationError("approved, generated, and manifest route sets do not match")
    if approved_ids != detail_ids:
        raise VerificationError("approved route set does not match lazy detail files")

    output_inventory: Counter[tuple[str, str]] = Counter()
    source_records: list[dict[str, Any]] = []
    approved_rows: list[list[str]] = []
    for spec in specs:
        slug = str(spec["activity_id"])
        detail = json.loads((detail_dir / f"{slug}.json").read_text(encoding="utf-8"))
        missing_fields = sorted(OUTPUT_REQUIRED_FIELDS - set(detail))
        if missing_fields:
            raise VerificationError(f"route {slug} is missing output fields: {', '.join(missing_fields)}")
        if detail != generated_by_slug[slug]:
            raise VerificationError(f"lazy detail and complete generated record disagree for {slug}")
        if manifest_by_slug[slug]["slug"] != detail["slug"]:
            raise VerificationError(f"manifest identity disagrees for {slug}")

        source_path, source_kind = source_file_for(spec, root, diesel_diaries)
        if not source_path.is_file():
            raise VerificationError(f"missing route source {source_path}")
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"datetime\.datetime\.utcfromtimestamp\(\) is deprecated.*",
                category=DeprecationWarning,
            )
            source_points = load_source_route_points(source_path)
        provenance = build_route_provenance(source_points)
        if provenance.route != detail["route"]:
            raise VerificationError(f"generated geometry does not match original source for {slug}")

        row = None if source_kind == "imported-gpx" else rows_by_id.get(slug)
        if source_kind == "strava-export" and row is None:
            raise VerificationError(f"approved route {slug} is absent from activities.csv")
        if row is not None:
            approved_rows.append(row)
        output_inventory.update(field_inventory(detail))
        source_records.append(
            {
                "slug": slug,
                "source_kind": source_kind,
                "source_suffix": "".join(source_path.suffixes),
                "source_bytes": source_path.stat().st_size,
                "source_sha256": sha256_file(source_path),
                "source_point_records": len(source_points),
                "published_points": len(detail["route"]),
                "quest_spec_sha256": canonical_sha256(spec),
                "activity_row_sha256": canonical_sha256(row) if row is not None else None,
                "detail_sha256": canonical_sha256(detail),
            }
        )

    column_evidence = []
    for index, name in enumerate(headers):
        values = [row[index] for row in activity_data_rows]
        approved_values = [row[index] for row in approved_rows]
        column_evidence.append(
            {
                "index": index,
                "name": name,
                "nonempty_values": sum(bool(value) for value in values),
                "values_sha256": canonical_sha256(values),
                "nonempty_approved_values": sum(bool(value) for value in approved_values),
                "approved_values_sha256": canonical_sha256(approved_values),
            }
        )

    row_evidence = [
        {
            "row_number": index + 2,
            "cells": len(row),
            "nonempty_cells": sum(bool(value) for value in row),
            "row_sha256": canonical_sha256(row),
        }
        for index, row in enumerate(activity_data_rows)
    ]

    case_records = []
    for case in MATRIX_CASES:
        slug = case["slug"]
        route = generated_by_slug.get(slug)
        if route is None:
            raise VerificationError(f"required real matrix route is missing: {slug}")
        case_records.append(
            {
                **case,
                "activity_type": route["type"],
                "lifecycle": route["lifecycle"],
                "replay_mode": route["replay"]["mode"],
                "temporal_status": route["provenance"]["temporal"]["status"],
                "curation_status": (route.get("curation") or {}).get(
                    "review_status", "draft"
                ),
            }
        )

    report: dict[str, Any] = {
        "schema_version": 1,
        "verified_at": datetime.now(UTC).isoformat(),
        "proof_scope": "real source exports through generated product artifacts",
        "privacy": "raw personal values omitted; byte and canonical hashes prove identity",
        "inputs": {
            "quests_sha256": sha256_file(root / "quests.json"),
            "activities_csv_sha256": sha256_file(diesel_diaries / "activities.csv"),
            "activities_rows": len(activity_data_rows),
            "activities_columns": len(headers),
            "approved_activity_rows": len(approved_rows),
            "imported_route_specs": sum(
                record["source_kind"] == "imported-gpx" for record in source_records
            ),
            "column_evidence": column_evidence,
            "row_evidence": row_evidence,
            "routes": source_records,
        },
        "outputs": {
            "approved_routes": len(approved_ids),
            "detail_files": len(detail_ids),
            "manifest_routes": len(manifest_by_slug),
            "generated_routes": len(generated_by_slug),
            "field_inventory": [
                {"path": path, "type": value_type, "occurrences": count}
                for (path, value_type), count in sorted(output_inventory.items())
            ],
            "matrix_cases": case_records,
        },
    }
    if rebuild:
        report["regeneration"] = compare_regeneration(
            root, python or root / ".venv/bin/python"
        )
    return report


def verify_nominatim(report: dict[str, Any], root: Path = ROOT) -> list[dict[str, Any]]:
    details = root / "app/public/data/routes"
    evidence = []
    for index, slug in enumerate(("17654151284", "9934715694", "3519505225411091950")):
        route = json.loads((details / f"{slug}.json").read_text(encoding="utf-8"))
        query = urllib.parse.urlencode(
            {
                "lat": f'{route["center_lat"]:.5f}',
                "lon": f'{route["center_lng"]:.5f}',
                "format": "jsonv2",
                "zoom": 10,
                "addressdetails": 1,
                "accept-language": "en",
            }
        )
        request = urllib.request.Request(
            f"https://nominatim.openstreetmap.org/reverse?{query}",
            headers={"User-Agent": "goDieselPipelineVerification/1.0", "Accept": "application/json"},
        )
        if index:
            time.sleep(1.1)
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
            status = response.status
        payload = json.loads(body)
        if status != 200 or "application/json" not in content_type or not payload.get("address"):
            raise VerificationError(f"Nominatim returned an invalid live response for {slug}")
        evidence.append(
            {
                "slug": slug,
                "status": status,
                "content_type": content_type,
                "response_bytes": len(body),
                "response_sha256": sha256_bytes(body),
                "top_level_fields": sorted(payload),
                "address_fields": sorted(payload["address"]),
            }
        )
    report["providers"] = {**report.get("providers", {}), "nominatim": evidence}
    return evidence


def verify_route_intelligence_artifact(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "corridor_m",
        "datasets",
        "generated_at",
        "journey_strip",
        "route_id",
        "samples",
        "signals",
        "visuals",
    }
    missing = sorted(required - set(payload))
    if missing:
        raise VerificationError(f"{path} is missing route-intelligence fields: {', '.join(missing)}")
    try:
        generated_at = datetime.fromisoformat(payload["generated_at"])
    except (TypeError, ValueError) as error:
        raise VerificationError(f"{path} has an invalid generated_at timestamp") from error
    if generated_at.tzinfo is None:
        raise VerificationError(f"{path} generated_at timestamp has no timezone")
    if not isinstance(payload["corridor_m"], int) or payload["corridor_m"] <= 0:
        raise VerificationError(f"{path} has an invalid analysis corridor")
    expected_datasets = {
        "GOOGLE/DYNAMICWORLD/V1",
        "COPERNICUS/DEM/GLO30_2024_1",
        "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL",
        "COPERNICUS/S2_SR_HARMONIZED",
    }
    dataset_ids = {dataset.get("id") for dataset in payload["datasets"]}
    if dataset_ids != expected_datasets:
        raise VerificationError(f"{path} does not prove every Earth Engine dataset")
    signal_fields = {"built", "change", "exposure", "green", "water"}
    if set(payload["signals"]) != signal_fields:
        raise VerificationError(f"{path} has an incomplete Earth Engine signal set")
    if any(
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not 0 <= value <= 100
        for value in payload["signals"].values()
    ):
        raise VerificationError(f"{path} has an invalid Earth Engine signal value")
    if len(payload["samples"]) != 48:
        raise VerificationError(f"{path} must contain 48 real Earth Engine samples")
    for index, sample in enumerate(payload["samples"]):
        if set(sample) != {"distance_km", *signal_fields}:
            raise VerificationError(f"{path} sample {index} has an incomplete field set")
        if any(
            type(value) not in (int, float) or not math.isfinite(value)
            for value in sample.values()
        ):
            raise VerificationError(f"{path} sample {index} contains a non-numeric value")
        if any(not 0 <= sample[field] <= 100 for field in signal_fields):
            raise VerificationError(f"{path} sample {index} has an out-of-range signal")
    sample_distances = [sample["distance_km"] for sample in payload["samples"]]
    if (
        sample_distances[0] != 0
        or sample_distances[-1] <= 0
        or sample_distances != sorted(sample_distances)
    ):
        raise VerificationError(f"{path} has invalid route sample distances")
    if len(payload["visuals"]) != 7:
        raise VerificationError(f"{path} must contain all seven Earth Engine scene types")
    expected_visuals = {
        "portrait",
        "recorded-season",
        "winter",
        "spring",
        "summer",
        "autumn",
        "terrain",
    }
    if {visual.get("key") for visual in payload["visuals"]} != expected_visuals:
        raise VerificationError(f"{path} has an incomplete Earth Engine scene set")
    if len(payload["journey_strip"]) < 2:
        raise VerificationError(f"{path} must contain a complete kilometer journey strip")
    journey_distances = [frame.get("distance_km") for frame in payload["journey_strip"]]
    if (
        any(type(value) not in (int, float) or not math.isfinite(value) for value in journey_distances)
        or journey_distances != sorted(journey_distances)
        or journey_distances[0] != 0
        or journey_distances[-1] != sample_distances[-1]
        or [frame.get("index") for frame in payload["journey_strip"]]
        != list(range(len(payload["journey_strip"])))
        or payload["journey_strip"][-1].get("is_finish") is not True
    ):
        raise VerificationError(f"{path} has an incomplete journey-strip sequence")

    route_id = str(payload["route_id"])
    image_records = [*payload["visuals"], *payload["journey_strip"]]
    image_evidence = []
    for record in image_records:
        source = str(record.get("src", ""))
        relative_parts = Path(source.lstrip("/")).parts
        try:
            route_index = relative_parts.index(route_id)
        except ValueError as error:
            raise VerificationError(f"{path} image source does not belong to route {route_id}") from error
        asset_path = path.parent.joinpath(*relative_parts[route_index:])
        if not asset_path.is_file() or asset_path.stat().st_size < 1_000:
            raise VerificationError(f"missing route-intelligence image: {asset_path}")
        with Image.open(asset_path) as image:
            extrema = image.convert("RGB").getextrema()
            if image.width < 100 or image.height < 100 or all(low == high for low, high in extrema):
                raise VerificationError(f"route-intelligence image is blank or undersized: {asset_path}")
            image_evidence.append(
                {
                    "name": asset_path.relative_to(path.parent).as_posix(),
                    "bytes": asset_path.stat().st_size,
                    "dimensions": [image.width, image.height],
                    "sha256": sha256_file(asset_path),
                }
            )
    return {
        "route_id": route_id,
        "artifact_sha256": sha256_file(path),
        "datasets": sorted(dataset_ids),
        "samples": len(payload["samples"]),
        "signals": sorted(payload["signals"]),
        "visuals": len(payload["visuals"]),
        "journey_frames": len(payload["journey_strip"]),
        "images": image_evidence,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--live-nominatim", action="store_true")
    parser.add_argument("--route-intelligence", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--diesel-diaries", type=Path, default=DEFAULT_DIESEL_DIARIES)
    args = parser.parse_args()

    report = verify_real_pipeline(
        diesel_diaries=args.diesel_diaries,
        rebuild=args.rebuild,
    )
    if args.live_nominatim:
        verify_nominatim(report)
    if args.route_intelligence:
        report["route_intelligence"] = [
            verify_route_intelligence_artifact(path) for path in args.route_intelligence
        ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"Verified {report['outputs']['approved_routes']} real routes, "
        f"{report['inputs']['activities_columns']} source columns, and "
        f"{len(report['outputs']['field_inventory'])} output field/type paths."
    )
    print(f"Evidence: {args.output}")


if __name__ == "__main__":
    main()
