from dataclasses import dataclass


@dataclass(frozen=True)
class RegionBox:
    south: float
    north: float
    west: float
    east: float
    name: str
    time_zone: str


REGION_BOXES = (
    RegionBox(28, 30, -16, -13, "Canary Islands", "Atlantic/Canary"),
    RegionBox(35, 36.5, 23, 26, "Crete, Greece", "Europe/Athens"),
    RegionBox(37, 39.5, 22, 25, "Mainland Greece", "Europe/Athens"),
    RegionBox(-9, -8, 115, 115.7, "Bali, Indonesia", "Asia/Makassar"),
    RegionBox(34.5, 35.5, 135.5, 136, "Kyoto, Japan", "Asia/Tokyo"),
    RegionBox(34, 40, 135, 141, "Japan", "Asia/Tokyo"),
    RegionBox(41.5, 43, 2, 3.5, "Costa Brava, Spain", "Europe/Madrid"),
    RegionBox(40, 41, -4, -3, "Madrid, Spain", "Europe/Madrid"),
    RegionBox(48, 49, -124, -123, "Victoria, BC", "America/Vancouver"),
    RegionBox(49, 50, -124, -122.5, "Vancouver, BC", "America/Vancouver"),
    RegionBox(49, 50, -126, -125, "Tofino, BC", "America/Vancouver"),
    RegionBox(50.5, 51.8, -116, -115, "Banff/Kananaskis", "America/Edmonton"),
    RegionBox(50.7, 51.3, -114.4, -113.7, "Calgary, AB", "America/Edmonton"),
    RegionBox(51.5, 53, -107, -106, "Saskatoon, SK", "America/Regina"),
    RegionBox(32.5, 34, -118, -117, "San Diego, CA", "America/Los_Angeles"),
    RegionBox(37.5, 38.5, -123, -122, "Bay Area, CA", "America/Los_Angeles"),
)

CURATED_TIME_ZONES = {
    "Bologna, Italy": "Europe/Rome",
    "Bragg Creek, AB": "America/Edmonton",
    "Highwood Pass": "America/Edmonton",
    "Hiroshima, Japan": "Asia/Tokyo",
    "London, UK": "Europe/London",
    "Los Angeles, CA": "America/Los_Angeles",
    "Nanaimo, BC": "America/Vancouver",
    "New York, NY": "America/New_York",
    "Okayama, Japan": "Asia/Tokyo",
    "Rome, Italy": "Europe/Rome",
    "Tokyo, Japan": "Asia/Tokyo",
    "Treviso, Italy": "Europe/Rome",
    "Ucluelet, BC": "America/Vancouver",
    "Veneto, Italy": "Europe/Rome",
    "Verona, Italy": "Europe/Rome",
}


def _region_time_zones() -> dict[str, str]:
    zones: dict[str, str] = {}
    for box in REGION_BOXES:
        if box.name in zones:
            raise RuntimeError(f"duplicate region box {box.name}")
        if not box.time_zone:
            raise RuntimeError(f"region box {box.name} has no timezone")
        zones[box.name] = box.time_zone
    overlap = sorted(set(CURATED_TIME_ZONES) & set(zones))
    if overlap:
        raise RuntimeError(
            "curated timezones repeat a region box: " + ", ".join(overlap)
        )
    zones.update(CURATED_TIME_ZONES)
    return zones


REGION_TIME_ZONES = _region_time_zones()


def classify_region(lat: float, lng: float) -> str:
    for box in REGION_BOXES:
        if box.south <= lat <= box.north and box.west <= lng <= box.east:
            return box.name
    return f"{lat:.1f}°, {lng:.1f}°"


def route_time_zone(region_label: str) -> str | None:
    return REGION_TIME_ZONES.get(region_label)


def time_zone_for_recorded_region(
    region_label: str, temporal_status: str | None
) -> str | None:
    if temporal_status != "recorded":
        return None
    zone = route_time_zone(region_label)
    if zone is None:
        raise ValueError(f"No IANA timezone for recorded region {region_label!r}")
    return zone
