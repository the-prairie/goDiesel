import json
from pathlib import Path

import pytest

from pipeline_verification import (
    MATRIX_CASES,
    ROOT,
    approved_specs,
    verify_real_pipeline,
    verify_route_intelligence_artifact,
)


@pytest.fixture(scope="module")
def real_report():
    return verify_real_pipeline()


def test_real_sources_cover_every_approved_generated_route_and_field(real_report):
    report = real_report

    assert report["outputs"]["approved_routes"] == len(approved_specs(ROOT))
    assert report["outputs"]["approved_routes"] == report["outputs"]["detail_files"]
    assert report["inputs"]["activities_columns"] == 103
    assert len(report["inputs"]["column_evidence"]) == report["inputs"][
        "activities_columns"
    ]
    assert len(report["inputs"]["row_evidence"]) == report["inputs"][
        "activities_rows"
    ]
    assert all(row["row_sha256"] for row in report["inputs"]["row_evidence"])
    assert report["inputs"]["approved_activity_rows"] + report["inputs"][
        "imported_route_specs"
    ] == report["outputs"]["approved_routes"]
    assert all(route["source_sha256"] for route in report["inputs"]["routes"])
    assert all(route["detail_sha256"] for route in report["inputs"]["routes"])


def test_real_browser_matrix_spans_current_pipeline_dimensions(real_report):
    report = real_report
    cases = report["outputs"]["matrix_cases"]

    assert {case["slug"] for case in cases} == {case["slug"] for case in MATRIX_CASES}
    assert {case["activity_type"] for case in cases} == {"Run", "Ride"}
    assert {case["replay_mode"] for case in cases} == {"earth", "atlas"}
    assert {case["lifecycle"] for case in cases} == {"completed", "discovered"}
    assert {case["temporal_status"] for case in cases} == {"recorded", "unavailable"}
    assert {case["curation_status"] for case in cases} == {"draft", "reviewed"}


def test_real_route_sources_are_outside_generated_output_tree(real_report):
    report = real_report
    generated_root = (ROOT / "app/public/data/routes").resolve()

    for route in report["inputs"]["routes"]:
        assert route["source_kind"] in {"strava-export", "imported-gpx"}
        assert route["source_point_records"] >= route["published_points"] >= 2
    assert generated_root.is_dir()


def test_current_earth_engine_artifacts_cover_every_dataset_signal_and_image():
    evidence = [
        verify_route_intelligence_artifact(
            ROOT / f"app/public/data/route-intelligence/{slug}.json"
        )
        for slug in ("14023448720", "14736711660")
    ]

    assert {record["route_id"] for record in evidence} == {
        "14023448720",
        "14736711660",
    }
    assert all(record["samples"] == 48 for record in evidence)
    assert all(record["visuals"] == 7 for record in evidence)
    assert all(record["journey_frames"] >= 20 for record in evidence)


TIMED_GPX = """<gpx version="1.1" creator="test"><trk><trkseg>
<trkpt lat="51" lon="-114"><ele>1000</ele><time>2026-01-01T10:00:00Z</time></trkpt>
<trkpt lat="51.005" lon="-114"><ele>1005</ele><time>2026-01-01T10:03:00Z</time></trkpt>
<trkpt lat="51.01" lon="-114"><ele>1010</ele><time>2026-01-01T10:06:00Z</time></trkpt>
</trkseg></trk></gpx>"""


def synthetic_verification_workspace(root, lifecycle):
    """One approved imported route, published exactly as build.py publishes it."""
    from pipeline_verification import OUTPUT_REQUIRED_FIELDS
    from route_provenance import (
        build_route_provenance,
        load_source_route_points,
        published_route_provenance,
    )

    (root / "route_sources").mkdir()
    source = root / "route_sources/timed.gpx"
    source.write_text(TIMED_GPX)
    (root / "quests.json").write_text(json.dumps({"routes": [{
        "activity_id": "timed", "status": "approved", "lifecycle": lifecycle,
        "source_gpx": "route_sources/timed.gpx",
    }]}))
    published = published_route_provenance(
        build_route_provenance(load_source_route_points(source)), lifecycle
    )
    detail = {field: "synthetic" for field in OUTPUT_REQUIRED_FIELDS}
    detail.update({"slug": "timed", "lifecycle": lifecycle, "route": published.route})
    (root / "app/public/data/routes").mkdir(parents=True)
    (root / "app/public/data/routes/timed.json").write_text(json.dumps(detail))
    (root / "app/src/data/generated").mkdir(parents=True)
    (root / "app/src/data/quests.generated.json").write_text(json.dumps({"routes": [detail]}))
    (root / "app/src/data/generated/routes.manifest.json").write_text(
        json.dumps({"routes": [{"slug": "timed"}]})
    )
    inputs = root / "inputs"
    inputs.mkdir()
    (inputs / "activities.csv").write_text("Activity Date,Filename,Distance\n")
    return inputs, published


@pytest.mark.parametrize("lifecycle", ["completed", "discovered"])
def test_verifier_compares_source_geometry_with_what_the_lifecycle_publishes(tmp_path, lifecycle):
    from pipeline_verification import VerificationError

    inputs, published = synthetic_verification_workspace(tmp_path, lifecycle)
    assert ("elapsed_s" in published.route[-1]) == (lifecycle == "completed")
    # The synthetic workspace has no real matrix routes, so a verifier that
    # accepts the geometry stops at the matrix stage instead.
    with pytest.raises(VerificationError, match="required real matrix route is missing"):
        verify_real_pipeline(tmp_path, inputs)


def test_verifier_still_rejects_geometry_that_differs_from_the_source(tmp_path):
    from pipeline_verification import VerificationError

    inputs, _ = synthetic_verification_workspace(tmp_path, "discovered")
    detail_path = tmp_path / "app/public/data/routes/timed.json"
    detail = json.loads(detail_path.read_text())
    detail["route"][-1]["lat"] += 0.001
    detail_path.write_text(json.dumps(detail))
    (tmp_path / "app/src/data/quests.generated.json").write_text(json.dumps({"routes": [detail]}))
    with pytest.raises(VerificationError, match="generated geometry does not match"):
        verify_real_pipeline(tmp_path, inputs)
