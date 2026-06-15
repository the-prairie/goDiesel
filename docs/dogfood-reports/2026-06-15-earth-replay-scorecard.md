# Earth Replay Route Scorecard

Date: 2026-06-15
Scope: 66 approved routes after route expansion and region cleanup
Local URL: `http://localhost:8787/?lab=earth#quest/<activity_id>`

## Summary

Earth Replay is strong enough to become the primary desktop replay surface.

- Total routes tested: 66
- Magical: 54
- Useful: 12
- Weak: 0
- Routes reaching Earth ready state: 66
- Routes reporting partial or unavailable 3D tiles: 0
- Remaining coordinate-style region labels: 0

The previous decision threshold was: if 16+ routes are `Magical` or `Useful`, Earth can graduate from lab toward primary replay. This run produced 66/66 routes in that range.

## Recommendation

Make Earth Replay the default desktop replay mode, while keeping Atlas as the explicit fallback/toggle.

Do not make Earth the only route view yet. Keep Atlas available because:

- It remains faster and clearer for quick route inspection.
- It is safer for mobile and lower-powered browsers.
- It is a useful fallback if Google Map Tiles API quota, billing, or browser key restrictions fail.

Suggested product rule:

- Desktop route detail: default to Earth Replay.
- Mobile route detail: default to Atlas until mobile Earth performance is tuned.
- Keep the `EARTH` / `ATLAS` toggle visible.
- Remember the last selected replay mode in local storage in a future pass.

## Methodology

Browser automation opened every approved route in Earth mode, waited for the Earth layer to reach `ready` or `unavailable`, scrubbed to roughly 42% route progress, then recorded Earth state, HUD status, tile warnings, route cam visibility, and page errors.

Scoring rubric:

- `Magical`: Earth Replay materially improves route understanding through terrain, route scale, elevation, coastline, mountains, or scenic context.
- `Useful`: Earth Replay works cleanly, but Atlas remains similarly useful, usually for dense urban or flatter routes.
- `Weak`: Earth fails to load, reports partial 3D tile coverage, times out, or feels worse than Atlas.

This is a browser/heuristic dogfood pass, not a hand-inspected cinematic review of every frame.

## Region Cleanup

The 20 coordinate-labelled generated regions were normalized in `quests.json` before rebuild:

- Okayama, Japan
- Hiroshima, Japan
- Bragg Creek, AB
- Calgary, AB
- London, UK
- Los Angeles, CA
- New York, NY
- Rome, Italy
- Bologna, Italy
- Veneto, Italy
- Verona, Italy
- Treviso, Italy
- Ucluelet, BC
- Nanaimo, BC

After rebuild, generated routes had 0 coordinate-style region labels.

## Scorecard

| Route | Region | Distance | Climb | Score | Earth status |
|---|---:|---:|---:|---|---|
| 17665674778 | Tokyo, Japan | 21.8 km | 286 m | Useful | Photorealistic 3D tiles |
| 17654151284 | Kyoto, Japan | 21.3 km | 680 m | Magical | Photorealistic 3D tiles |
| 17636880071 | Kyoto, Japan | 32.6 km | 557 m | Magical | Photorealistic 3D tiles |
| 17626995684 | Japan | 21.2 km | 211 m | Useful | Photorealistic 3D tiles |
| 17616195995 | Okayama, Japan | 21.0 km | 514 m | Magical | Photorealistic 3D tiles |
| 17606492777 | Hiroshima, Japan | 19.3 km | 272 m | Magical | Photorealistic 3D tiles |
| 17597564971 | Hiroshima, Japan | 22.2 km | 497 m | Magical | Photorealistic 3D tiles |
| 17586941421 | Japan | 20.0 km | 291 m | Useful | Photorealistic 3D tiles |
| 17576988805 | Tokyo, Japan | 19.8 km | 236 m | Useful | Photorealistic 3D tiles |
| 17569931129 | Tokyo, Japan | 21.9 km | 307 m | Useful | Photorealistic 3D tiles |
| 16366737881 | Bragg Creek, AB | 24.1 km | 668 m | Magical | Photorealistic 3D tiles |
| 15573295095 | Banff/Kananaskis | 22.0 km | 965 m | Magical | Photorealistic 3D tiles |
| 15562324390 | Banff/Kananaskis | 23.3 km | 620 m | Magical | Photorealistic 3D tiles |
| 15182597704 | Calgary, AB | 27.6 km | 692 m | Magical | Photorealistic 3D tiles |
| 13835672113 | Bay Area, CA | 21.5 km | 397 m | Magical | Photorealistic 3D tiles |
| 13807396994 | Bay Area, CA | 25.5 km | 407 m | Magical | Photorealistic 3D tiles |
| 14736711660 | Bay Area, CA | 28.5 km | 493 m | Magical | Photorealistic 3D tiles |
| 14486170630 | London, UK | 21.4 km | 460 m | Magical | Photorealistic 3D tiles |
| 14422331296 | Canary Islands | 17.9 km | 282 m | Magical | Photorealistic 3D tiles |
| 14415835303 | Canary Islands | 46.7 km | 688 m | Magical | Photorealistic 3D tiles |
| 14394581660 | Canary Islands | 27.4 km | 441 m | Magical | Photorealistic 3D tiles |
| 14349820520 | Canary Islands | 32.9 km | 862 m | Magical | Photorealistic 3D tiles |
| 14262327221 | Canary Islands | 25.9 km | 625 m | Magical | Photorealistic 3D tiles |
| 14160295943 | Canary Islands | 37.2 km | 1036 m | Magical | Photorealistic 3D tiles |
| 14130782031 | Crete, Greece | 15.1 km | 868 m | Magical | Photorealistic 3D tiles |
| 14130772463 | Crete, Greece | 7.4 km | 187 m | Magical | Photorealistic 3D tiles |
| 14130768855 | Crete, Greece | 29.1 km | 803 m | Magical | Photorealistic 3D tiles |
| 14080158961 | Crete, Greece | 30.6 km | 746 m | Magical | Photorealistic 3D tiles |
| 14064880083 | Crete, Greece | 21.2 km | 880 m | Magical | Photorealistic 3D tiles |
| 14030669837 | Crete, Greece | 21.4 km | 658 m | Magical | Photorealistic 3D tiles |
| 14023448720 | Crete, Greece | 21.5 km | 606 m | Magical | Photorealistic 3D tiles |
| 13134774070 | Crete, Greece | 24.1 km | 460 m | Magical | Photorealistic 3D tiles |
| 13971753429 | Mainland Greece | 26.2 km | 982 m | Magical | Photorealistic 3D tiles |
| 13941094274 | Mainland Greece | 19.7 km | 931 m | Magical | Photorealistic 3D tiles |
| 13935098460 | Mainland Greece | 28.4 km | 493 m | Magical | Photorealistic 3D tiles |
| 13534813116 | Saskatoon, SK | 18.4 km | 189 m | Magical | Photorealistic 3D tiles |
| 13358070690 | Banff/Kananaskis | 20.7 km | 175 m | Magical | Photorealistic 3D tiles |
| 10082410891 | Bali, Indonesia | 19.8 km | 715 m | Magical | Photorealistic 3D tiles |
| 10075093128 | Bali, Indonesia | 22.7 km | 328 m | Magical | Photorealistic 3D tiles |
| 9959792315 | Bali, Indonesia | 17.3 km | 142 m | Magical | Photorealistic 3D tiles |
| 9953403673 | Bali, Indonesia | 14.3 km | 89 m | Magical | Photorealistic 3D tiles |
| 9945324433 | Bali, Indonesia | 18.5 km | 329 m | Magical | Photorealistic 3D tiles |
| 9915035779 | Los Angeles, CA | 23.2 km | 56 m | Useful | Photorealistic 3D tiles |
| 9934715694 | Highwood Pass | 109.1 km | 1689 m | Magical | Photorealistic 3D tiles |
| 9845102380 | Banff/Kananaskis | 191.9 km | 2064 m | Magical | Photorealistic 3D tiles |
| 9844581410 | New York, NY | 13.3 km | 142 m | Useful | Photorealistic 3D tiles |
| 8836227189 | Rome, Italy | 18.3 km | 139 m | Useful | Photorealistic 3D tiles |
| 8836227016 | Bologna, Italy | 17.0 km | 367 m | Useful | Photorealistic 3D tiles |
| 8836226791 | Bologna, Italy | 20.0 km | 136 m | Useful | Photorealistic 3D tiles |
| 8836226736 | Bologna, Italy | 17.9 km | 269 m | Useful | Photorealistic 3D tiles |
| 8790922344 | Veneto, Italy | 21.5 km | 274 m | Magical | Photorealistic 3D tiles |
| 8788969453 | Verona, Italy | 16.8 km | 234 m | Magical | Photorealistic 3D tiles |
| 8788967538 | Treviso, Italy | 14.8 km | 54 m | Magical | Photorealistic 3D tiles |
| 8767788731 | Costa Brava, Spain | 113.1 km | 1382 m | Magical | Photorealistic 3D tiles |
| 8762819138 | Costa Brava, Spain | 91.7 km | 815 m | Magical | Photorealistic 3D tiles |
| 8761568343 | Madrid, Spain | 25.7 km | 315 m | Useful | Photorealistic 3D tiles |
| 6496900063 | Ucluelet, BC | 11.3 km | 236 m | Magical | Photorealistic 3D tiles |
| 6477420224 | Nanaimo, BC | 21.2 km | 312 m | Magical | Photorealistic 3D tiles |
| 5981399261 | Nanaimo, BC | 12.1 km | 300 m | Magical | Photorealistic 3D tiles |
| 5944474545 | Vancouver, BC | 10.5 km | 225 m | Magical | Photorealistic 3D tiles |
| 5868096334 | Nanaimo, BC | 18.4 km | 158 m | Magical | Photorealistic 3D tiles |
| 5837509151 | Nanaimo, BC | 18.4 km | 453 m | Magical | Photorealistic 3D tiles |
| 5786313644 | Victoria, BC | 15.4 km | 108 m | Magical | Photorealistic 3D tiles |
| 5650407638 | Victoria, BC | 84.6 km | 651 m | Magical | Photorealistic 3D tiles |
| 5460495850 | Victoria, BC | 21.2 km | 175 m | Magical | Photorealistic 3D tiles |
| 5420668682 | Victoria, BC | 21.0 km | 176 m | Magical | Photorealistic 3D tiles |

## Useful Routes

These routes worked cleanly in Earth Replay but are less decisive than scenic/mountain/coastal routes:

- Tokyo, Japan: 17665674778, 17576988805, 17569931129
- Japan: 17626995684, 17586941421
- Los Angeles, CA: 9915035779
- New York, NY: 9844581410
- Rome, Italy: 8836227189
- Bologna, Italy: 8836227016, 8836226791, 8836226736
- Madrid, Spain: 8761568343

## Next Step

Implement the product graduation:

1. Default desktop route detail to Earth Replay.
2. Keep Atlas as the fallback/toggle.
3. Keep mobile on Atlas until mobile Earth performance is tested.
4. Add local storage for the user's last selected replay mode.
