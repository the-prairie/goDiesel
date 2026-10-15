# Route cover artwork

The Routes library uses AI-enhanced aerial illustrations, with recorded GPS geometry drawn separately in SVG. These are editorial covers, not navigation imagery. Atlas, route maps, and Replay continue to use their original geographic providers.

## Asset pipeline

- `prepare.py` caches an Esri World Imagery export for each route's actual Web Mercator bounding square and projects every recorded point into that square.
- `import_ai.py <slug> <generated-image>` converts a reviewed generated background to a local WebP, retaining the original projection. Keep the original generated output; the app references only workspace assets.
- Assets live in `app/public/route-covers/`; source/geometry hashes and projection metadata live in `app/src/data/route-covers/manifest.json`.
- Original source JPEGs and generation receipts are retained locally under ignored `app/artifacts/route-covers/`.
- Both scripts require Pillow. Generation uses the built-in image_gen tool, not a runtime AI API.
- The UI omits generation labels and credits the imagery source in a quiet bottom line. Generation provenance remains in the asset manifest. Generation can reinterpret geographic details; the separate recorded trace does not make generated terrain navigation-grade.
- Sharp imagery and route use matching contain/meet transforms. A dim blurred copy fills the surrounding frame without cropping the trace. Failed images fall back to the original vector route silhouette.
- Covers load lazily from the deployed app. Browsing does not call an image-generation or map-image API.

## Generation prompt set

Each route gets its own source JPEG and one built-in image_gen edit. The prompt below is suffixed with the route's region and slug:

> Use case: lighting-weather. Asset type: premium aerial terrain route-card illustration for goDiesel. Enhance this exact satellite image into a richly detailed, editorial aerial image. Keep the camera straight overhead, preserve the complete original square extent, geographic layout, river and coast outlines, streets, parks, mountain ridges and their exact screen positions. Do not rotate, tilt, crop, zoom or rearrange geography. Improve terrain dimensionality with subtle warm early-morning raking light and natural shadows, deep forest greens, clean blue-green water, balanced crisp detail and restrained cinematic contrast. Remove satellite tile seams without changing terrain. No invented mountains, dramatic clouds, buildings or landmarks. No route line, pins, labels, badges, typography, borders or UI. Output a single square image; the app will overlay the actual recorded GPS separately.

For arid, alpine, and coastal source images the prompt adds:

> Preserve the source biome: arid land stays arid, snow stays snow, and vegetation is only enhanced where it exists.

Tokyo's initial accepted cover uses the same treatment. Kyoto's initial wide prototype was replaced by a square source-based image to match the library's framing.
