import {describe,it,expect} from "vitest";
import {preparedCameraPath} from "./world-prepared-view";
import type {QuestRoute} from "@/domain/route";
import type {GoogleRouteCameraPose} from "../playback/route-navigator-controller";
const route={provenance:{discontinuities:[]}} as unknown as QuestRoute;
const pose=(progressM:number):GoogleRouteCameraPose=>({progressM,center:{lat:51,lng:-114,altitude:1000},headingDeg:350,tiltDeg:65,rangeM:180,fovDeg:50});
describe("prepared camera travel",()=>{
  it("checks two intermediate positions and the destination for a short move",()=>{
    const from=pose(9000),to={...pose(9150),headingDeg:10,rangeM:300};
    const path=preparedCameraPath(from,to,route);
    expect(path).toHaveLength(3);expect(path[0].progressM).toBe(9049.5);expect(path[0].headingDeg).toBeCloseTo(356.6);
    expect(path[2]).toMatchObject({progressM:9150,rangeM:300});expect(from.headingDeg).toBe(350);
  });
  it("never claims a long seek has a prepared flight corridor",()=>{expect(preparedCameraPath(pose(0),pose(9850),route)).toHaveLength(1);});
  it("uses a cut across a point gap as well as a range gap",()=>{
    for(const gap of [{startD:9050,endD:9050},{startD:9010,endD:9200}]) {
      expect(preparedCameraPath(pose(9000),pose(9100),{provenance:{discontinuities:[gap]}} as QuestRoute)).toHaveLength(1);
      expect(preparedCameraPath(pose(9100),pose(9000),{provenance:{discontinuities:[gap]}} as QuestRoute)).toHaveLength(1);
    }
  });
  it("does not swing around the globe at the date line",()=>{
    const from={...pose(0),center:{lat:0,lng:179.999,altitude:100}},to={...pose(100),center:{lat:0,lng:-179.999,altitude:100}};
    const path=preparedCameraPath(from,to,route);expect(path.every(p=>Math.abs(p.center.lng-180)<.002)).toBe(true);
  });
  it("does not prepare three wide horizons",()=>{expect(preparedCameraPath({...pose(0),rangeM:10000},pose(10),route)).toHaveLength(1);});
});
