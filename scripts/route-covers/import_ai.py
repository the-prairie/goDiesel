"""Import a reviewed AI cover; overlay coordinates are supplied from source data."""
import argparse,hashlib,json
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('slug');p.add_argument('image',type=Path);p.add_argument('--projection',type=Path);a=p.parse_args()
mp=ROOT/'app/src/data/route-covers/manifest.json';manifest=json.loads(mp.read_text());record=manifest[a.slug]
if a.projection:record.update(json.loads(a.projection.read_text()))
with Image.open(a.image) as im:
 im.thumbnail((960,960))
 im.convert('RGB').save(ROOT/'app/public/route-covers'/(a.slug+'-ai.webp'),'WEBP',quality=80,method=6)
record.update(src=f'/route-covers/{a.slug}-ai.webp',kind='ai-enhanced',artworkSha256=hashlib.sha256(a.image.read_bytes()).hexdigest(),generator='Built-in image_gen',note='AI-enhanced illustration. Recorded geometry is rendered separately; depicted geographic detail is not navigation evidence.')
mp.write_text(json.dumps(manifest,indent=2)+'\n')
print(record['src'])
