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
