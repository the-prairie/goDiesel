from pathlib import Path


BUILD = Path(__file__).with_name("build.py").read_text()


def test_mobile_route_cam_sits_above_control_stack():
    assert ".route-cam { right: 10px; bottom: 214px;" in BUILD
    assert "width: min(260px, calc(100% - 20px));" in BUILD


def test_route_cam_uses_street_view_not_maplibre_inset():
    assert "new google.maps.StreetViewPanorama" in BUILD
    assert "route-cam-label\" id=\"routeCamLabel\">Street View" in BUILD
    assert "routeCamMap = new maplibregl.Map" not in BUILD
