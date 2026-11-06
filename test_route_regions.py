import pytest

from route_regions import (
    REGION_BOXES,
    REGION_TIME_ZONES,
    classify_region,
    time_zone_for_recorded_region,
)
from route_timezones import route_time_zone


def test_every_box_has_one_timezone_and_curated_labels_keep_theirs():
    assert len({box.name for box in REGION_BOXES}) == len(REGION_BOXES)
    for box in REGION_BOXES:
        assert REGION_TIME_ZONES[box.name] == box.time_zone
    assert route_time_zone("Nanaimo, BC") == "America/Vancouver"
    assert route_time_zone("Highwood Pass") == "America/Edmonton"
    assert route_time_zone("Unknown trail") is None


def test_san_diego_calgary_tofino_and_nanaimo_resolve():
    assert classify_region(32.7157, -117.1611) == "San Diego, CA"
    assert route_time_zone("San Diego, CA") == "America/Los_Angeles"
    assert classify_region(49.152, -125.906) == "Tofino, BC"
    assert route_time_zone("Tofino, BC") == "America/Vancouver"
    assert classify_region(51.0447, -114.0719) == "Calgary, AB"
    assert route_time_zone("Calgary, AB") == "America/Edmonton"
    assert classify_region(48.4284, -123.3656) == "Victoria, BC"
    assert classify_region(49.1659, -123.9364) == "Vancouver, BC"


def test_earlier_box_wins_when_boxes_overlap():
    assert classify_region(34.985, 135.758) == "Kyoto, Japan"
    assert classify_region(35.681, 139.767) == "Japan"


def test_a_recorded_route_without_a_timezone_fails():
    assert (
        time_zone_for_recorded_region("San Diego, CA", "recorded")
        == "America/Los_Angeles"
    )
    assert time_zone_for_recorded_region("Kyoto, Japan", "estimated") is None
    label = classify_region(0, 0)
    assert label == "0.0°, 0.0°"
    with pytest.raises(ValueError, match="0.0°, 0.0°"):
        time_zone_for_recorded_region(label, "recorded")
