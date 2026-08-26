# World source receipts

These canonical receipts bind retainable public source objects to exact local custody bytes.
The large source objects live under ignored `world-packs-local/sources`; the receipt, adapter, licence evidence checksum, immutable object version, byte size, and SHA-256 are the committed acquisition contract.

Validate the Ucluelet custody set with:

```sh
.venv/bin/python -m scripts.verify_world_source_receipt \
  docs/world-packs/sources/ucluelet-lidarbc-2019.json \
  world-packs-local/sources/ucluelet/2019
```

Receipt admission fails closed when retention, derivatives, or redistribution are not allowed, when the legal decision is not `admit`, when a filename escapes custody, or when any retained byte differs.
The receipt does not claim full exploration-envelope coverage; the compiler must still run an exact coverage-union gate before promotion.

Normalize the admitted Ucluelet DEM with the pinned acquisition environment:

```sh
python -m scripts.normalize_world_terrain \
  app/public/data/routes/6496900063.json \
  docs/world-packs/sources/ucluelet-lidarbc-2019.json \
  world-packs-local/sources/ucluelet/2019 \
  lidarbc-2019-dem-1m \
  world-packs-local/normalized/ucluelet-coastal-terrain.json \
  --exploration-radius-m 2000 \
  --step-m 25 \
  --vertical-datum CGVD2013 \
  --nodata-semantic water
```

Banff uses a bounded `cog-window-v1` extraction from the 83.85 GB MRDEM DTM.
The receipt records the parent object ETag and size, exact EPSG:3979 pixel window, WGS84 envelope, OGL-Canada evidence, and embedded Copernicus obligations.

```sh
python -m scripts.verify_world_source_receipt \
  docs/world-packs/sources/banff-mrdem-2026.json \
  world-packs-local/sources/banff/2026
```
