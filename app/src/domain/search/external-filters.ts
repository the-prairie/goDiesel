import type {FinderIntent} from '../planning';
import type {ExternalRoute} from './external';
import {distanceBounds} from './intent';
import {assessRoute} from './route-quality';
export function matchesExternalRoute(r:ExternalRoute,intent:FinderIntent) {
  const [min,max]=distanceBounds(intent);
  if(r.activity!==intent.activity || r.distanceKm<min || r.distanceKm>max || (intent.maxElevationM!=null && (r.ascentM==null || r.ascentM>intent.maxElevationM))) return false;
  const quality=assessRoute(r);
  if(quality.distanceMismatch && (quality.mappedKm<min || quality.mappedKm>max)) return false;
  if(intent.terrain==='any') return true;
  const surfaces=r.surface ? r.surface.split(';') : (r.surfaceCoverage??0)>=.999999 ? r.surfaces?.flatMap(s=>s.split(';'))??[] : [];
  if(!surfaces.length) return false;
  const paved=new Set(['asphalt','paved','concrete','paving_stones']);
  const unpaved=new Set(['ground','dirt','earth','gravel','fine_gravel','compacted','unpaved','rock','sand','grass']);
  if(intent.terrain==='road') return surfaces.every(s=>paved.has(s));
  if(intent.terrain==='trail') return surfaces.every(s=>unpaved.has(s));
  if(intent.terrain==='mixed') return surfaces.every(s=>paved.has(s)||unpaved.has(s)) && surfaces.some(s=>paved.has(s))&&surfaces.some(s=>unpaved.has(s));
  return false; // Surface tags alone do not establish mountainous terrain.
}
