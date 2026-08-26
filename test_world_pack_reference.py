import json
from pathlib import Path

import pytest

from world_packs.reference_corpus import (
    DEFAULT_OUTPUT_PATH,
    ROOT,
    canonical_json_bytes,
    capture_reference_corpus,
)


EXPECTED_ROUTES = {
    "tokyo-urban": {
        "slug": "17665674778",
        "sha256": "21e5254dd4b4249562acaf3b91b56b3bddf205a283882d75121bf8ff0a66ac3f",
        "pointCount": 377,
        "discontinuityCount": 2,
    },
    "banff-mountain": {
        "slug": "15573295095",
        "sha256": "666e7bcc2b7214ca24703ecd66470a963af1df1e11b5bc9fbc182258aba820f6",
        "pointCount": 397,
        "discontinuityCount": 1,
    },
    "ucluelet-coastal": {
        "slug": "6496900063",
        "sha256": "e3b686096040cc905228fe9cacce67d625ed1b68f06d7c27c5381175e586bf63",
        "pointCount": 203,
        "discontinuityCount": 0,
    },
}


def test_reference_corpus_matches_committed_baseline():
    captured = capture_reference_corpus()
    baseline = (ROOT / DEFAULT_OUTPUT_PATH).read_bytes()

    assert canonical_json_bytes(captured) == baseline


def test_reference_corpus_pins_public_route_evidence():
    captured = capture_reference_corpus()

    assert {route["class"] for route in captured["routes"]} == {
        "dense-urban",
        "high-relief-mountain",
        "remote-coastal",
    }
    for route in captured["routes"]:
        expected = EXPECTED_ROUTES[route["id"]]
        assert route["slug"] == expected["slug"]
        assert route["source"]["sha256"] == expected["sha256"]
        assert route["source"]["evidence"] == "derived"
        assert route["route"]["pointCount"] == expected["pointCount"]
        assert route["route"]["discontinuityCount"] == expected["discontinuityCount"]
        assert [control["role"] for control in route["route"]["controls"]] == [
            "start",
            "midpoint",
            "end",
        ]
        assert all(
            control["evidence"] == "recorded"
            for control in route["route"]["controls"]
        )


def test_reference_corpus_rejects_route_path_escape(tmp_path: Path):
    (tmp_path / "docs/world-packs").mkdir(parents=True)
    declaration = {
        "schemaVersion": 1,
        "sourceCommit": "test",
        "routes": [
            {
                "id": f"escape-{index}",
                "class": route_class,
                "slug": str(index),
                "routeDetail": "../../outside.json",
            }
            for index, route_class in enumerate(
                ["dense-urban", "high-relief-mountain", "remote-coastal"],
                start=1,
            )
        ],
    }
    (tmp_path / "docs/world-packs/reference-corpus.json").write_text(
        json.dumps(declaration),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="escapes the repository"):
        capture_reference_corpus(tmp_path)
