import { describe, expect, it } from "vitest";

import { PHONE_KEYS_PX, phoneWorldScreen } from "@/labs/overland/model/world-screen";
import { WORLD_MAP } from "@/labs/overland/model/overland-towns";

const notch = { top: 47, right: 0, bottom: 34, left: 0 };
const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe("phoneWorldScreen", () => {
  it("fills a tall phone edge to edge at a whole-pixel scale, the keys below in thumb reach", () => {
    const screen = phoneWorldScreen({ width: 375, height: 812, safe: notch });
    expect(screen.scale).toBe(3);
    expect(screen.cols).toBe(125);
    expect(screen.cols * screen.scale).toBeLessThanOrEqual(375);
    expect(375 - screen.cols * screen.scale).toBeLessThan(screen.scale);
    // Everything fits: safe areas, the screen and the keys.
    expect(notch.top + screen.rows * screen.scale + PHONE_KEYS_PX + notch.bottom).toBeLessThanOrEqual(812);
    expect(812 - (notch.top + screen.rows * screen.scale + PHONE_KEYS_PX + notch.bottom)).toBeLessThan(screen.scale);
  });

  it("fits a short phone and a wider one", () => {
    const short = phoneWorldScreen({ width: 375, height: 667, safe: { ...none, top: 20 } });
    expect(short.scale).toBe(3);
    expect(20 + short.rows * 3 + PHONE_KEYS_PX).toBeLessThanOrEqual(667);
    expect(phoneWorldScreen({ width: 390, height: 844, safe: notch })).toMatchObject({ scale: 3, cols: 130 });
  });

  it("drops to a smaller scale in landscape, so the map keeps enough height", () => {
    const landscape = phoneWorldScreen({ width: 812, height: 375, safe: { top: 0, right: 47, bottom: 21, left: 47 } });
    expect(landscape.scale).toBe(2);
    expect(landscape.cols).toBe(Math.floor((812 - 94) / 2));
    expect(landscape.rows * 2 + PHONE_KEYS_PX + 21).toBeLessThanOrEqual(375);
  });

  it("never shows more rows than the world map has, with its text box", () => {
    const tall = phoneWorldScreen({ width: 320, height: 2000, safe: none });
    expect(tall.rows).toBeLessThanOrEqual(WORLD_MAP.height + 34);
  });
});
