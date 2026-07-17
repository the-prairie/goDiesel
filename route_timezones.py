"""Curated IANA timezones for the route regions in the personal atlas."""

REGION_TIME_ZONES = {
    "Bali, Indonesia": "Asia/Makassar",
    "Banff/Kananaskis": "America/Edmonton",
    "Bay Area, CA": "America/Los_Angeles",
    "Bologna, Italy": "Europe/Rome",
    "Bragg Creek, AB": "America/Edmonton",
    "Calgary, AB": "America/Edmonton",
    "Canary Islands": "Atlantic/Canary",
    "Costa Brava, Spain": "Europe/Madrid",
    "Crete, Greece": "Europe/Athens",
    "Highwood Pass": "America/Edmonton",
    "Hiroshima, Japan": "Asia/Tokyo",
    "Japan": "Asia/Tokyo",
    "Kyoto, Japan": "Asia/Tokyo",
    "London, UK": "Europe/London",
    "Los Angeles, CA": "America/Los_Angeles",
    "Madrid, Spain": "Europe/Madrid",
    "Mainland Greece": "Europe/Athens",
    "Nanaimo, BC": "America/Vancouver",
    "New York, NY": "America/New_York",
    "Okayama, Japan": "Asia/Tokyo",
    "Rome, Italy": "Europe/Rome",
    "Saskatoon, SK": "America/Regina",
    "Tokyo, Japan": "Asia/Tokyo",
    "Treviso, Italy": "Europe/Rome",
    "Ucluelet, BC": "America/Vancouver",
    "Vancouver, BC": "America/Vancouver",
    "Veneto, Italy": "Europe/Rome",
    "Verona, Italy": "Europe/Rome",
    "Victoria, BC": "America/Vancouver",
}


def route_time_zone(region_label: str) -> str | None:
    return REGION_TIME_ZONES.get(region_label)
