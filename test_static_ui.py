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
    assert 'class="earth-route-thread" id="earthRouteThread"' in BUILD
    assert 'class="earth-thread-preview" id="earthThreadPreview"' in BUILD
    assert 'class="earth-thread-progress" id="earthThreadProgress"' in BUILD
    assert "function earthLocalRoutePositions(route, idx)" in BUILD
    assert "function earthTrailPositions(route, idx)" in BUILD
    assert "function earthScreenPath(route, startIdx, endIdx, heightOffset = 230)" in BUILD
    assert "function positionEarthRouteThread()" in BUILD
    assert "return earthPositionsBetween(route, idx - 60, idx + 120, 145);" in BUILD
    assert "return earthPositionsBetween(route, idx - 60, idx, 175);" in BUILD
    assert "earthFullEntity.polyline.positions = earthLocalRoutePositions(route, idx);" in BUILD
    assert "earthProgressEntity.polyline.positions = earthTrailPositions(route, idx);" in BUILD
    assert "viewer.scene.postRender.addEventListener(positionEarthRouteThread);" in BUILD
    assert "earthOverlayIdx = idx;" in BUILD
    assert "arcType: Cesium.ArcType.NONE" in BUILD
    assert "depthFailMaterial: Cesium.Color.fromCssColorString('#00f19f').withAlpha(0.94)" in BUILD


def test_earth_marker_uses_persistent_lottie_avatar():
    assert "const AVATAR_STORAGE_KEY = 'quests:route-avatar';" in BUILD
    assert "const ROUTE_AVATARS = [" in BUILD
    assert "route-avatars/run-rex.lottie" in BUILD
    assert "route-avatars/nyan-cat.lottie" in BUILD
    assert "route-avatars/mario.lottie" in BUILD
    assert "route-avatars/walking.lottie" in BUILD
    assert "route-avatars/hangout-running.lottie" in BUILD
    assert "route-avatars/astronaut.lottie" not in BUILD
    assert 'class="route-control route-avatar" id="routeAvatarBtn"' in BUILD
    assert 'class="avatar-picker" id="avatarPicker"' in BUILD
    assert 'class="earth-avatar-marker" id="earthAvatarMarker"' in BUILD
    assert "function loadLottiePlayer()" in BUILD
    assert "function avatarPlayerMarkup" in BUILD
    assert "function positionEarthAvatarMarker()" in BUILD
    assert "function selectRouteAvatar" in BUILD
    assert "viewer.scene.postRender.addEventListener(positionEarthAvatarMarker);" in BUILD
    assert "earthMarkerPosition = earthAvatarPositionAt(route, idx);" in BUILD
    assert "dotlottie-player" in BUILD
    assert "billboard: {" not in BUILD
    assert "avatarImageDataUri" not in BUILD
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


def test_globe_lab_is_query_addressable_without_changing_earth_replay():
    assert 'class="globe-lab" id="globeLab"' in BUILD
    assert 'id="globeCanvas"' in BUILD
    assert "const GLOBE_LAB_MODE = queryParams.get('lab') === 'globe';" in BUILD
    assert "function showGlobe(options = {})" in BUILD
    assert "else if (GLOBE_LAB_MODE) showGlobe({ updateUrl: false });" in BUILD
    assert "if (GLOBE_LAB_MODE) showGlobe({ updateUrl: false });" in BUILD


def test_globe_lab_routes_to_existing_open_route_flow():
    assert "function globeRouteRegions()" in BUILD
    assert "function buildGlobeScene()" in BUILD
    assert "function selectGlobeRegion(region" in BUILD
    assert "onclick=\"openRoute(${region.indexes[i]})\"" in BUILD
    assert "document.getElementById('globeLab').classList.remove('active');" in BUILD


def test_globe_lab_supports_direct_navigation_controls():
    assert "touch-action: none" in BUILD
    assert 'class="globe-sidebar" aria-label="Globe navigation"' in BUILD
    assert 'class="globe-nav" aria-label="Globe views"' in BUILD
    assert "function openSelectedGlobeRoute()" in BUILD
    assert 'onclick="openSelectedGlobeRoute()"' in BUILD
    assert "canvas.addEventListener('pointerdown', handleGlobePointerDown);" in BUILD
    assert "canvas.addEventListener('mousedown', handleGlobeMouseDown);" in BUILD
    assert "canvas.addEventListener('touchstart', handleGlobeTouchStart, { passive: false });" in BUILD
    assert "canvas.addEventListener('wheel', handleGlobeWheel, { passive: false });" in BUILD
    assert "globeTargetRotation.y = globeDrag.rotY + dx * 0.006;" in BUILD
    assert "globeCameraDistance = clamp(globeCameraDistance + event.deltaY * 0.004, 4.8, 9.2);" in BUILD
    assert "el.addEventListener('click', () => selectGlobeRegion(region));" in BUILD


def test_globe_uses_route_heat_traces_not_visible_orbs():
    assert "let globeHotspots = [], globeHeatLines = []" in BUILD
    assert "function routeToGlobeHeatPoints(route, radius = 2.505)" in BUILD
    assert "function makeGlobeHeatLine(route, regionIndex)" in BUILD
    assert "new THREE.CatmullRomCurve3(points)" in BUILD
    assert "new THREE.TubeGeometry(curve" in BUILD
    assert "blending: THREE.AdditiveBlending" in BUILD
    assert "region.routes.forEach(route => {" in BUILD
    assert "globeHeatLines.push(line);" in BUILD
    assert "new THREE.SphereGeometry(0.085, 12, 8)" in BUILD
    assert "opacity: 0," in BUILD
    assert "globeHeatLines.forEach(line => {" in BUILD
    assert "0.055 + Math.min(region.routes.length" not in BUILD
    assert "dot.scale.setScalar(selected ? 1.7 : 1);" not in BUILD
    assert "new THREE.QuadraticBezierCurve3" not in BUILD


def test_globe_projection_has_texture_context_and_label_occlusion():
    assert "radius * Math.cos(latRad) * Math.sin(lngRad)" in BUILD
    assert "radius * Math.sin(latRad)" in BUILD
    assert "radius * Math.cos(latRad) * Math.cos(lngRad)" in BUILD
    assert "new THREE.TextureLoader().load(" in BUILD
    assert "raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg" in BUILD
    assert "texture.offset.x = 0.25;" in BUILD
    assert "globe.material.color.set(0x9fb7ac);" in BUILD
    assert "() => globe.material.color.set(0x10242c)" in BUILD
    assert "facing > 0.16" in BUILD
    assert "const collides = placed.some" in BUILD
    assert "item.selected || !collides" in BUILD


def test_globe_lab_region_header_expands_all_regions():
    assert 'onclick="toggleGlobeRegionMenu()"' in BUILD
    assert 'onkeydown="handleGlobeRegionHeadKey(event)"' in BUILD
    assert 'class="globe-region-menu" id="globeRegionMenu"' in BUILD
    assert 'id="globeRegionReset"' in BUILD
    assert "function toggleGlobeRegionMenu()" in BUILD
    assert "function handleGlobeRegionHeadKey(event)" in BUILD
    assert "function resetGlobeRegion(event)" in BUILD
    assert "event?.stopPropagation();" in BUILD
    assert "function renderGlobeRegionMenu()" in BUILD
    assert "function renderGlobeRegionOverview()" in BUILD
    assert "panel?.classList.toggle('region-selected', Boolean(selectedGlobeRegion));" in BUILD
    assert "if (name) name.textContent = 'Route regions';" in BUILD
    assert "if (!selectedGlobeRegion && globeRegions.length) renderGlobeRegionOverview();" in BUILD
    assert "globe-route-panel.menu-open .globe-region-menu" in BUILD
    assert "globe-route-panel.menu-open .globe-route-list" in BUILD
    assert "onclick=\"selectGlobeRegion(globeRegions[${i}])\"" in BUILD


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
