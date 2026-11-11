import {describe,it,expect} from 'vitest';
import {discoveryPreference,rankExternalRoutes} from './external-ranking';
import {matchesExternalRoute} from './external-filters';
import type {ExternalRoute} from './external';
const intent={query:'a woodland run near Banff under 10 km',place:'Banff',activity:'Run' as const,distanceKm:10,maxDistanceKm:10,terrain:'any' as const,vibe:''};
const route:ExternalRoute={id:'osm-1',name:'Forest walk',sourceUrl:'https://www.openstreetmap.org/relation/1',lines:[[[0,0],[.02,0]]],distanceKm:2.2,distanceKind:'mapped',activity:'Run'};
describe('external ranking and strict filters',()=>{
  it('removes already enforced geography and numeric constraints from semantic intent',()=>{expect(discoveryPreference(intent)).toBe('woodland');});
  it('gives exact name matches weight without pretending names prove a theme',()=>{
    const result=rankExternalRoutes([route,{...route,id:'osm-2',name:'Creek trail'}],'forest');
    expect(result[0].route.id).toBe('osm-1');expect(result[0].reason).toContain('Source mentions forest');
    expect(rankExternalRoutes([route],'woodland',[[1,0],[1,0]])[0].reason).toBe('');
  });
  it('rejects a distance fit when mapped paths contradict the source distance',()=>{
    expect(matchesExternalRoute({...route,distanceKm:1,distanceKind:'source'}, {...intent,maxDistanceKm:1.5})).toBe(false);
  });
  it('does not let semantic relevance override unknown climb or partial surface evidence',()=>{
    expect(matchesExternalRoute(route,{...intent,maxElevationM:200})).toBe(false);
    expect(matchesExternalRoute({...route,surfaces:['gravel'],surfaceCoverage:.5},{...intent,terrain:'trail'})).toBe(false);
    expect(matchesExternalRoute({...route,surfaces:['gravel','dirt'],surfaceCoverage:1},{...intent,terrain:'trail'})).toBe(true);
    expect(matchesExternalRoute({...route,surfaces:['gravel','asphalt'],surfaceCoverage:1},{...intent,terrain:'mixed'})).toBe(true);
  });
});
