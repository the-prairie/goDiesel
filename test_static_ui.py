from pathlib import Path


BUILD = Path(__file__).with_name("build.py").read_text()
README = Path(__file__).with_name("README.md").read_text()


def test_mobile_route_cam_sits_above_control_stack():
    assert ".route-cam { right: 10px; bottom: 214px;" in BUILD
    assert "width: min(260px, calc(100% - 20px));" in BUILD


def test_route_cam_uses_street_view_not_maplibre_inset():
    assert "new google.maps.StreetViewPanorama" in BUILD
    assert "route-cam-label\" id=\"routeCamLabel\">Street View" in BUILD
    assert "routeCamMap = new maplibregl.Map" not in BUILD


def test_replay_mode_defaults_to_earth_on_desktop_and_atlas_on_mobile():
    assert "const REPLAY_MODE_STORAGE_KEY = 'quests:replay-mode';" in BUILD
    assert "function defaultReplayMode()" in BUILD
    assert "window.matchMedia?.('(max-width: 700px)').matches ? 'atlas' : 'earth'" in BUILD
    assert "const replayModePreference = requestedReplayMode || getReplayModePreference() || defaultReplayMode();" in BUILD


def test_earth_lab_mode_is_query_addressable_without_dev_modes():
    assert "const requestedReplayMode = requestedCinemaModeRaw === 'earth' || requestedCinemaModeRaw === 'atlas'" in BUILD
    assert "if (replayModePreference === 'earth') {" in BUILD
    assert "routeCinemaEnabled = false;" in BUILD
    assert "if (!earthModeEnabled && ROUTE_CINEMA_MODES.includes(requestedCinemaMode))" in BUILD


def test_earth_lab_has_dedicated_stage_and_fallback():
    assert 'class="earth-layer" id="earthLayer"' in BUILD
    assert 'class="earth-canvas" id="earthCanvas"' in BUILD
    assert 'id="earthFallbackTitle">Earth mode unavailable' in BUILD
    assert "function setEarthMode(" in BUILD


def test_earth_lab_lazy_loads_cesium_and_google_tiles():
    assert "function loadCesiumApi()" in BUILD
    assert "https://cesium.com/downloads/cesiumjs/releases/" in BUILD
    assert "https://tile.googleapis.com/v1/3dtiles/root.json?key=" in BUILD
    assert "function initEarthReplay(route)" in BUILD


def test_earth_lab_updates_from_shared_route_index():
    assert "updateEarthReplay(r, idx);" in BUILD
    assert "function updateEarthReplay(route, idx)" in BUILD
    assert "function updateEarthCamera(route, idx)" in BUILD


def test_earth_route_overlay_is_local_and_depth_safe():
    assert "function earthLocalRoutePositions(route, idx)" in BUILD
    assert "function earthTrailPositions(route, idx)" in BUILD
    assert "earthFullEntity.polyline.positions = earthLocalRoutePositions(route, idx);" in BUILD
    assert "earthProgressEntity.polyline.positions = earthTrailPositions(route, idx);" in BUILD
    assert "depthFailMaterial" not in BUILD


def test_earth_marker_uses_persistent_avatar_billboard():
    assert "const AVATAR_STORAGE_KEY = 'quests:route-avatar';" in BUILD
    assert "const ROUTE_AVATARS = [" in BUILD
    assert 'class="route-control route-avatar" id="routeAvatarBtn"' in BUILD
    assert 'class="avatar-picker" id="avatarPicker"' in BUILD
    assert "function avatarImageDataUri" in BUILD
    assert "canvas.toDataURL('image/png')" in BUILD
    assert "function selectRouteAvatar" in BUILD
    assert "billboard: {" in BUILD
    assert "image: avatarImageDataUri()" in BUILD
    assert "point: {" not in BUILD


def test_earth_camera_uses_route_metrics_not_fixed_constants():
    assert "function earthRouteMetrics(route)" in BUILD
    assert "function earthCameraProfile(route, playing, scrubbing = false)" in BUILD
    assert "const profile = earthCameraProfile(route, routePlaying, performance.now() < earthScrubUntil);" in BUILD
    assert "profile.lookahead" in BUILD
    assert "profile.trailing" in BUILD
    assert "profile.pitch" in BUILD


def test_earth_tile_status_reports_partial_coverage():
    assert "function attachEarthTileStatus(viewer, tileset, token)" in BUILD
    assert "tileFailed.addEventListener" in BUILD
    assert "tileLoadProgressEvent.addEventListener" in BUILD
    assert "EARTH_PARTIAL_TILE_FAILURE_THRESHOLD" in BUILD
    assert "3D tiles partially unavailable" in BUILD
    assert "Settling 3D tiles" in BUILD


def test_earth_replay_has_visible_url_state_toggle():
    assert 'class="route-control route-earth" id="routeEarthBtn"' in BUILD
    assert "function toggleEarthReplay()" in BUILD
    assert "params.set('lab', enabled ? 'earth' : 'atlas');" in BUILD
    assert "setReplayModePreference(nextMode);" in BUILD
    assert "earthBtn.textContent = earthModeEnabled ? 'ATLAS' : 'EARTH';" in BUILD


def test_best_in_earth_routes_are_marked_in_gallery_and_detail():
    assert "const BEST_IN_EARTH_ROUTES = new Set([" in BUILD
    assert "'13935098460'" in BUILD
    assert "function isBestInEarth(route)" in BUILD
    assert "quest-chip earth" in BUILD
    assert "detail-earth-badge" in BUILD
    assert "Best in Earth" in BUILD


def test_earth_scrub_camera_and_blank_frame_detection():
    assert "earthScrubUntil = performance.now() + 750;" in BUILD
    assert "earthViewer.camera.cancelFlight?.();" in BUILD
    assert "function checkEarthBlankFrame()" in BUILD
    assert "preserveDrawingBuffer: true" in BUILD
    assert "3D tiles partially unavailable" in BUILD


def test_readme_documents_map_tiles_key_restrictions():
    assert "Map Tiles API" in README
    assert "http://localhost:8787/*" in README
    assert "Cloudflare Pages domain" in README
    assert "same browser key restriction" in README
