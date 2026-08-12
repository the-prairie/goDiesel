# Daydream Atlas Prototype Assets

These assets support the approved Daydream Atlas hybrid prototype direction.
They are generated concept imagery for prototype use and contain no baked-in interface, text, logos, route overlays, markers, people, device frames, or watermarks.

## Asset Manifest

| Asset | Public path | Dimensions | Format | Role | Crop guidance |
| --- | --- | ---: | --- | --- | --- |
| World First | `/prototype-assets/daydream-atlas/world-first.webp` | 1536 x 1024 | WebP | Bright immersive Atlas and Finder terrain backdrop | Use `cover`; center or `50% 52%` preserves the coast and central ridge; wide crops may safely lose sky; portrait crops should bias right to retain terrain detail. |
| Story Flight | `/prototype-assets/daydream-atlas/story-flight.webp` | 1536 x 1024 | WebP | Darker cinematic Replay backdrop | Use `cover`; center preserves the valley flight line; place primary controls over the darker lower third or upper-left blue sky; avoid cropping the warm horizon entirely. |
| Memory 01 | `/prototype-assets/daydream-atlas/memory-01.webp` | 502 x 498 | WebP | Sunlit green hills and tactile clouds | Square master; safe for `1 / 1`, `4 / 3`, and center-cropped `3 / 2`; preserve the cloud bank and lower-right hill. |
| Memory 02 | `/prototype-assets/daydream-atlas/memory-02.webp` | 498 x 498 | WebP | Peach moon, clouds, and blue ridges | Square master; keep object position centered and avoid aggressive top cropping so the moon remains legible. |
| Memory 03 | `/prototype-assets/daydream-atlas/memory-03.webp` | 503 x 498 | WebP | Lavender alpine road at dawn | Square master; use center crop; the road supports a useful chapter or destination focal point. |
| Memory 04 | `/prototype-assets/daydream-atlas/memory-04.webp` | 502 x 498 | WebP | Soft rainbow over coastal cliffs | Square master; use `object-position: 55% 50%` for wide crops to retain both the coast and rainbow. |
| Memory 05 | `/prototype-assets/daydream-atlas/memory-05.webp` | 498 x 498 | WebP | Butter light breaking over a green valley | Square master; center crop; preserve the upper light break and central valley. |
| Memory 06 | `/prototype-assets/daydream-atlas/memory-06.webp` | 503 x 498 | WebP | Pink twilight over blue layered ridges | Square master; center crop; the lower silhouette can take a subtle text scrim if needed. |
| Cloud Halftone | `/prototype-assets/daydream-atlas/cloud-halftone.png` | 1024 x 682 | PNG | Optional atmospheric print texture | Use as a decorative low-opacity layer at roughly 4-12%; it has a pale-blue background rather than alpha transparency, so use `mix-blend-mode: multiply` or restrict it to matching pale-blue surfaces. |

## Implementation Notes

The two full-bleed backdrops are compressed at WebP quality 86.
The six memory images are compressed at WebP quality 84 and intentionally retain square masters so the prototype can test multiple card shapes.
The halftone texture is RGB PNG, not a transparent alpha mask.
Use semantic CSS overlays for legibility rather than modifying the source images.
Respect `prefers-reduced-motion` when animating background position, scale, or parallax.

## Generation Direction

The shared direction is soft, playful, atmospheric, and cartographic without becoming childish.
The palette emphasizes celestial and twilight blues, cloud white, grass green, lavender mist, petal pink, butter light, and restrained apricot warmth.
