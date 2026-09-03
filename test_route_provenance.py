from datetime import UTC, datetime, timedelta

from route_provenance import (
    SourceRoutePoint,
    build_route_provenance,
    load_source_route_points,
    project_public_route_provenance,
    source_point_from_fit_fields,
)
from route_timezones import route_time_zone


def point(
    lat: float,
    lng: float,
    *,
    seconds: int | None,
    segment: int = 0,
) -> SourceRoutePoint:
    timestamp = (
        datetime(2025, 11, 26, 21, 21, 5, tzinfo=UTC) + timedelta(seconds=seconds)
        if seconds is not None
        else None
    )
    return SourceRoutePoint(
        lat=lat,
        lng=lng,
        elevation=12,
        timestamp=timestamp,
        segment_index=segment,
    )


def test_timestamped_clean_track_preserves_temporal_provenance():
    result = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0),
            point(35.0005, 135.0, seconds=30),
            point(35.001, 135.0, seconds=60),
        ],
        sample_interval_m=0,
    )

    assert result.temporal == {
        "status": "recorded",
        "start_time_utc": "2025-11-26T21:21:05Z",
        "elapsed_time_s": 60,
    }
    assert result.track == {"segment_count": 1}
    assert result.discontinuities == []
    assert [route_point["elapsed_s"] for route_point in result.route] == [0, 30, 60]


def test_explicit_track_segment_boundary_is_preserved_as_evidence():
    result = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0),
            point(35.0005, 135.0, seconds=30),
            point(35.001, 135.001, seconds=45, segment=1),
            point(35.0015, 135.001, seconds=75, segment=1),
        ],
        sample_interval_m=0,
    )

    assert result.track == {"segment_count": 2}
    assert result.discontinuities == [
        {
            "kind": "segment_boundary",
            "source": "recorded_track_segment",
            "start_d": result.route[1]["d"],
            "end_d": result.route[2]["d"],
            "elapsed_time_s": 15,
        }
    ]


def test_missing_timestamps_remain_explicitly_unavailable():
    result = build_route_provenance(
        [
            point(35.0, 135.0, seconds=None),
            point(35.0005, 135.0, seconds=None),
            point(35.001, 135.0, seconds=None),
        ],
        sample_interval_m=0,
    )

    assert result.temporal == {"status": "unavailable"}
    assert result.discontinuities == []
    assert all("elapsed_s" not in route_point for route_point in result.route)


def test_recording_gap_uses_timestamp_evidence_not_point_spacing():
    result = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0),
            point(35.0005, 135.0, seconds=30),
            point(35.001, 135.0, seconds=240),
        ],
        sample_interval_m=0,
        recording_gap_seconds=120,
    )

    assert result.discontinuities == [
        {
            "kind": "recording_gap",
            "source": "recorded_timestamps",
            "start_d": result.route[1]["d"],
            "end_d": result.route[2]["d"],
            "elapsed_time_s": 210,
        }
    ]


def test_gpx_loader_preserves_timestamps_and_segment_boundaries(tmp_path):
    gpx = tmp_path / "segmented.gpx"
    gpx.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel">
  <trk><name>Segmented route</name>
    <trkseg>
      <trkpt lat="35.0" lon="135.0"><ele>10</ele><time>2025-11-26T21:21:05Z</time></trkpt>
      <trkpt lat="35.0005" lon="135.0"><ele>11</ele><time>2025-11-26T21:21:35Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="35.001" lon="135.001"><ele>12</ele><time>2025-11-26T21:21:50Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>"""
    )

    points = load_source_route_points(gpx)

    assert [point.segment_index for point in points] == [0, 0, 1]
    assert points[0].timestamp == datetime(2025, 11, 26, 21, 21, 5, tzinfo=UTC)


def test_gpx_without_elevation_stays_unavailable(tmp_path):
    gpx = tmp_path / "high-plateau.gpx"
    gpx.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel">
  <trk><trkseg>
    <trkpt lat="27.98" lon="86.90" />
    <trkpt lat="27.99" lon="86.91" />
  </trkseg></trk>
</gpx>"""
    )

    result = build_route_provenance(load_source_route_points(gpx), sample_interval_m=0)

    assert result.elevation == {"status": "unavailable"}
    assert [point["elev"] for point in result.route] == [None, None]


def test_partially_recorded_elevation_normalizes_to_unavailable(tmp_path):
    gpx = tmp_path / "partial-elevation.gpx"
    gpx.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel">
  <trk><trkseg>
    <trkpt lat="27.98" lon="86.90"><ele>5100</ele></trkpt>
    <trkpt lat="27.99" lon="86.91" />
  </trkseg></trk>
</gpx>"""
    )

    result = build_route_provenance(load_source_route_points(gpx), sample_interval_m=0)

    assert result.elevation == {"status": "unavailable"}
    assert [point["elev"] for point in result.route] == [None, None]


def test_fit_adapter_preserves_timestamp_and_converts_semicircles():
    point = source_point_from_fit_fields(
        {
            "position_lat": 2**30,
            "position_long": -(2**30),
            "enhanced_altitude": 123.4,
            "timestamp": datetime(2025, 11, 26, 21, 21, 5),
        }
    )

    assert point == SourceRoutePoint(
        lat=90,
        lng=-90,
        elevation=123.4,
        timestamp=datetime(2025, 11, 26, 21, 21, 5, tzinfo=UTC),
        segment_index=0,
    )


def test_fit_adapter_preserves_timestamp_when_position_is_missing():
    point = source_point_from_fit_fields(
        {"timestamp": datetime(2025, 11, 26, 21, 21, 5)}
    )

    assert point == SourceRoutePoint(
        lat=None,
        lng=None,
        elevation=None,
        timestamp=datetime(2025, 11, 26, 21, 21, 5, tzinfo=UTC),
        segment_index=0,
    )


def test_missing_position_records_are_preserved_as_discontinuity_evidence():
    result = build_route_provenance(
        [
            SourceRoutePoint(
                lat=None,
                lng=None,
                elevation=0,
                timestamp=datetime(2025, 11, 26, 21, 21, 5, tzinfo=UTC),
            ),
            point(35.0, 135.0, seconds=10),
            SourceRoutePoint(
                lat=None,
                lng=None,
                elevation=0,
                timestamp=datetime(2025, 11, 26, 21, 21, 35, tzinfo=UTC),
            ),
            point(35.001, 135.0, seconds=60),
        ],
        sample_interval_m=0,
    )

    assert result.temporal["start_time_utc"] == "2025-11-26T21:21:05Z"
    assert result.route[0]["elapsed_s"] == 10
    assert result.discontinuities == [
        {
            "kind": "missing_position_records",
            "source": "recorded_position_absence",
            "start_d": result.route[0]["d"],
            "end_d": result.route[1]["d"],
            "elapsed_time_s": 50,
            "missing_record_count": 1,
        }
    ]


def test_short_single_missing_position_record_is_not_a_discontinuity():
    result = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0),
            SourceRoutePoint(
                lat=None,
                lng=None,
                elevation=0,
                timestamp=datetime(2025, 11, 26, 21, 21, 8, tzinfo=UTC),
            ),
            point(35.001, 135.0, seconds=7),
        ],
        sample_interval_m=0,
    )

    assert result.discontinuities == []


def test_curated_regions_map_to_explicit_iana_timezones():
    assert route_time_zone("Kyoto, Japan") == "Asia/Tokyo"
    assert route_time_zone("Banff/Kananaskis") == "America/Edmonton"
    assert route_time_zone("Canary Islands") == "Atlantic/Canary"
    assert route_time_zone("Unknown trail") is None


def test_public_provenance_adds_the_resolved_time_zone():
    source = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0),
            point(35.001, 135.0, seconds=60),
        ],
        sample_interval_m=0,
    )

    route, provenance = project_public_route_provenance(
        source,
        lifecycle="completed",
        time_zone="Asia/Tokyo",
    )

    assert route == source.route
    assert provenance["temporal"] == {
        **source.temporal,
        "time_zone": "Asia/Tokyo",
    }
    assert provenance["track"] == source.track


def test_discovered_public_provenance_removes_owner_timing_claims():
    source = build_route_provenance(
        [
            point(35.0, 135.0, seconds=0, segment=0),
            point(35.001, 135.0, seconds=180, segment=1),
        ],
        sample_interval_m=0,
    )

    route, provenance = project_public_route_provenance(
        source,
        lifecycle="discovered",
        time_zone="Asia/Tokyo",
    )

    assert provenance["temporal"] == {"status": "unavailable"}
    assert all("elapsed_s" not in item for item in route)
    assert all(
        "elapsed_time_s" not in item for item in provenance["discontinuities"]
    )
    assert provenance["track"] == source.track
