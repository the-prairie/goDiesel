# Atlas Cinematic Zoom Design QA

## Visual Target

- Global reference: `docs/design-reference/spatial-atlas/cinematic-earth-global.png`
- Regional reference: `docs/design-reference/spatial-atlas/cinematic-earth-region.png`
- Global implementation: `docs/design-reference/spatial-atlas/implementation-global.png`
- Regional fallback implementation: `docs/design-reference/spatial-atlas/implementation-region-fallback.png`

## Accepted Product Flow

The Atlas opens as a full-bleed interactive Earth with completed route threads.

Selecting a place rotates, zooms, and tilts the same world into a regional terrain view.

The route carousel appears only after the regional transition begins.

Selecting a route highlights its thread and preserves the route-to-replay navigation path.

## Same-Viewport Comparison

The global implementation now matches the reference hierarchy: the Earth is the primary object, Europe and the Mediterranean are the initial focus, navigation is a single restrained band, and route history is drawn from real activity geometry.

The implementation intentionally uses fewer persistent labels than the reference so route density remains readable while the globe moves.

The global route threads use a luminous sea-glass treatment with a coral selected state.

The concept image depicts a continent-scale road network that is not present in the user's activity history.

The implementation intentionally does not synthesize that density.

At global scale, shorter recorded routes read as small luminous traces until the user zooms into a region.

The regional layout matches the reference structure: place context in the top band, terrain as the dominant visual, and a low route filmstrip with four visible choices on desktop.

The bundled Natural Earth fallback cannot match the regional reference's photorealistic terrain.

That screenshot is retained as provider-failure evidence rather than as an accepted visual target.

The intended regional state continues to use Google Photorealistic 3D Tiles when the provider is available.

## Responsive Review

The globe remains interactive at desktop, phone, tablet, landscape, and short-height viewports.

The regional route filmstrip is clipped below the immersive header and collapses its secondary header at short heights.

The top-level World action remains available when the carousel controls are intentionally reduced.

Search is intentional rather than permanently occupying the map.

## Interaction Review

- Reset and zoom controls remain available in global and regional states.
- Globe route selection opens the corresponding region.
- The Explore Crete entry point exercises the approved global-to-regional journey.
- Regional route cards select a thread without leaving the terrain.
- Open route enters replay with Atlas return context.
- Browser history restores region and route selection.

## Provider Limitation

The local fallback uses the bundled low-resolution Natural Earth imagery because it does not require network access.

It is a functional continuity state, not the designed regional experience.

Live visual acceptance requires the Google 3D provider gate to pass with available quota and a correctly restricted key.

## Final Result

Passed for the deterministic global-to-regional interaction, responsive layout, and global visual composition.

Conditional for photorealistic regional fidelity until the live-provider gate is green.
