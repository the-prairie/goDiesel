"""Prepare cached satellite covers and recorded overlays; no runtime map requests.
AI backgrounds are imported separately and never supply route geometry.
"""
import argparse, concurrent.futures, hashlib, json, math, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'app/public/route-covers'
SOURCE=ROOT/'app/artifacts/route-covers/sources'
MANIFEST=ROOT/'app/src/data/route-covers/manifest.json'
def prepare(r):
 points=json.loads((ROOT/'app/public/data/routes'/(r['slug']+'.json')).read_text())['route']; radius=6378137
 xy=[(radius*math.radians(p['lng']),radius*math.log(math.tan(math.pi/4+math.radians(p['lat'])/2))) for p in points]
 cx=(min(p[0] for p in xy)+max(p[0] for p in xy))/2;cy=(min(p[1] for p in xy)+max(p[1] for p in xy))/2
 span=max(max(p[0] for p in xy)-min(p[0] for p in xy),max(p[1] for p in xy)-min(p[1] for p in xy),300)*1.35
 bbox=[cx-span/2,cy-span/2,cx+span/2,cy+span/2]
 slug=r['slug']; source=SOURCE/(slug+'.jpg')
 if not source.exists():
  args={'bbox':','.join(map(str,bbox)),'bboxSR':3857,'imageSR':3857,'size':'720,720','format':'jpg','f':'image'}
  url='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?'+urllib.parse.urlencode(args)
  source.write_bytes(urllib.request.urlopen(url,timeout=60).read())
 with Image.open(source) as im:
  im.save(ASSETS/(slug+'.webp'),'WEBP',quality=83,method=6)
 return slug,{'src':f'/route-covers/{slug}.webp','kind':'satellite','width':720,'height':720,'points':' '.join(f'{(x-bbox[0])/span*720:.2f},{(bbox[3]-y)/span*720:.2f}' for x,y in xy),'source':'Esri World Imagery','bbox':bbox,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
def main():
 ASSETS.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
 routes=json.loads((ROOT/'app/src/data/generated/routes.manifest.json').read_text())['routes']
 previous=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
 out={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for slug,record in pool.map(prepare,routes):
   out[slug]=previous.get(slug,record) if previous.get(slug,{}).get('kind')=='ai-enhanced' else record
   print(slug,flush=True)
 MANIFEST.write_text(json.dumps(out,indent=2)+'\n')
 print(f'Prepared {len(out)} covers')
if __name__=='__main__':main()
