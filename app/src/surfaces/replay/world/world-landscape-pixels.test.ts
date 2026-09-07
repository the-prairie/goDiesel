import { describe, expect, it } from "vitest";
import { landscapePixels } from "../../../../scripts/landscape-pixels";
function image(flatBand = false) {
  const width=640,height=480,data=new Uint8Array(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const v=flatBand && y>height*.24 && y<height*.5 ? 120 : 90+(x*17+y*31)%120;
    data.set([v,v,v,255],(y*width+x)*4);
  }
  return {width,height,data};
}
describe("Runner visual acceptance",()=> {
  it("rejects broad flat holes even beside highly detailed foreground",()=> {
    const result=landscapePixels(image(true));
    expect(result.textureVariation).toBeGreaterThan(.015); // old assertion falsely passed
    expect(result.flatFraction).toBeGreaterThan(.18);
    expect(landscapePixels(image()).flatFraction).toBe(0);
  });
  it("rejects absent or malformed pixels instead of accepting an empty mask",()=> {
    expect(()=>landscapePixels({width:0,height:0,data:[]})).toThrow();
  });
});
