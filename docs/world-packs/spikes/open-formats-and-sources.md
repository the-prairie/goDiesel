# Open formats and public acquisition sources

Status: focused Stage 1 technical spike, 2026-08-26.

This spike selects a bounded open-format profile for the first Core World Pack compiler and identifies retainable public-source candidates for the fixed Tokyo, Banff, and Ucluelet corridors.
It does not grant permission to use a dataset and it does not prove that a source meets the later visual, physical, or emotional-quality gates.
Every acquisition adapter must still capture the selected asset's own licence and metadata at acquisition time.

## Method and evidence labels

Research was limited to normative specifications, standards bodies, first-party source repositories, official project documentation, government catalogues, and licence pages.
No provider-rendered basemap or photorealistic tile is treated as an archival source merely because it is technically downloadable.

- **Researched fact** reports what a cited primary source specifies or publishes.
- **Recommendation** is the World Pack design decision proposed from those facts.
- **Confirmed coverage** means an official catalogue or spatial query covers the fixed route extent.
- **Conditional coverage** means the collection is viable but its exact route intersection or asset-level licence still needs a build-time check.
- **Not verified** means this spike found no retainable route-level source and the pack must not imply otherwise.

## Decision

Stage 1 Core should pin this profile:

| World Pack concern | Core format | Role |
| --- | --- | --- |
| Manifests, inventories, checksums, lineage, coverage, and attribution | UTF-8 JSON, strict JSON Schema, RFC 8785 canonicalization for hashed documents | Canonical contract and identity inputs |
| Route thread, terrain mesh, collision, structures, and traversable surfaces | GLB using glTF 2.0 | Portable runtime geometry |
| Spatial hierarchy for terrain and structures | 3D Tiles 1.1 with glTF content | Local visual LOD index when one GLB is not sufficient |
| Render-ready roads, paths, and trails | PMTiles version 3 containing MVT | Local tiled runtime delivery |
| Elevation and orthorectified imagery | COG conforming to GeoTIFF 1.1 | Retained normalized raster and compiler input |
| Lossless normalized vector features and attributes | GeoParquet 1.1.0 | Repairable analytical and transformation input |
| Point clouds, when a Core build actually has them | Source LAZ retained unchanged; derived COPC 1.0 | Evidence preservation plus spatially selective processing |
| Portable export | Deterministic ZIP64 with stored entries | Cross-platform transfer wrapper, not pack identity |

FlatGeobuf remains an allowed adapter interchange and debugging output, but is not a second canonical Stage 1 vector representation.
Point clouds are optional inputs for Core, not a required runtime dependency.
3D Tiles is required only when the route corridor needs a tile hierarchy; small fixtures may reference GLB directly.

## Format findings

### glTF and GLB

**Researched fact.**
Khronos defines glTF 2.0 as an API-neutral runtime asset delivery format for scenes, nodes, meshes, materials, cameras, and animations, and explicitly says glTF is neither a streaming format nor an authoring format ([glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)).
The GLB container can hold the JSON description, one binary buffer, and images in one binary blob, although a GLB may still refer to external resources ([GLB file-format section](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format-specification)).

**Recommendation.**
Use self-contained GLB for each independently addressable route, terrain, structure, collision, or traversable-surface artifact.
Reject external URIs in sealed Core GLBs so that a geometry checksum covers every required buffer and texture byte.
Record the geospatial CRS, vertical datum, local origin, axis conversion, units, quantization, generator version, and source lineage in the World Pack manifest rather than relying on application-specific glTF extras.
Do not treat GLB as source evidence or as the only collision authority.

### 3D Tiles

**Researched fact.**
OGC 3D Tiles 1.1 defines a hierarchical structure for streaming massive 3D geospatial content including photogrammetry, buildings, BIM/CAD, and point clouds, while leaving visualization behavior to the client ([OGC standard landing page](https://www.ogc.org/standards/3dtiles/) and [3D Tiles 1.1 specification](https://docs.ogc.org/cs/22-025r4/22-025r4.html)).
Version 1.1 integrates glTF content and defines tileset metadata, bounding volumes, geometric error, refinement, and explicit or implicit tiling ([3D Tiles 1.1 specification](https://docs.ogc.org/cs/22-025r4/22-025r4.html)).

**Recommendation.**
Use 3D Tiles 1.1 only as the visual spatial hierarchy over local glTF content.
Keep physical collision and navigation in separately checksummed GLBs and navigation artifacts.
Pin all referenced content to pack-relative paths and disallow network URIs, signed URLs, and implicit subtree references outside the pack.
Do not introduce legacy `b3dm`, `i3dm`, `pnts`, or `cmpt` production outputs in Stage 1.

### PMTiles

**Researched fact.**
PMTiles version 3 is a single-file archive with a fixed header, root directory, JSON metadata, optional leaf directories, and tile data; its root directory must fit in the first 16 KiB for latency-oriented clients ([PMTiles v3 specification](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)).
The header identifies tile type and supports MVT, PNG, JPEG, WebP, AVIF, MapLibre Vector Tile, and Terrarium terrain encodings, while the JSON metadata can carry attribution ([PMTiles v3 specification](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)).
The specification is CC0 and the reference implementations are BSD-3-Clause ([PMTiles repository licence statement](https://github.com/protomaps/PMTiles/blob/main/README.md#license)).

**Recommendation.**
Use PMTiles v3 with MVT for derived runtime roads, paths, and trails.
Keep authoritative normalized vectors in GeoParquet because PMTiles is a tile-delivery artifact and does not define the World Pack feature schema or transformation lineage.
Write stable tile IDs, stable feature ordering, fixed metadata key ordering, a pinned compression mode, and mandatory source attribution.
Regenerate the PMTiles archive from retained normalized vectors instead of editing it in place.

### COG and GeoTIFF

**Researched fact.**
A Cloud Optimized GeoTIFF is a regular GeoTIFF whose internal layout places image file directories, overviews, and tiled image data so clients can issue HTTP byte-range reads rather than retrieve the entire file ([COG specification](https://github.com/cogeotiff/cog-spec/blob/master/spec.md)).
The COG specification intentionally leaves choices such as tile size and compression open, so two valid writers need not emit identical bytes for the same pixels ([COG unspecified-points section](https://github.com/cogeotiff/cog-spec/blob/master/spec.md#unspecified-points)).
GeoTIFF 1.1 is maintained as an OGC standard and embeds georeferencing keys in TIFF ([OGC GeoTIFF repository](https://github.com/opengeospatial/geotiff)).

**Recommendation.**
Use COG for normalized elevation, orthophotography, masks, and source-quality rasters.
Pin the writer and version, tiling, overview levels, resampling algorithm, compression, predictor, nodata representation, CRS, vertical datum, and metadata policy in the transformation record.
Hash the actual output bytes and compare decoded sample grids in deterministic tests because format conformance alone does not imply byte-identical output.
Do not make COG a required browser runtime decoder in Stage 1; the compiler may derive local meshes and materials from it.

### GeoParquet and FlatGeobuf

**Researched fact.**
GeoParquet 1.1.0 defines Parquet geometry encodings, required `geo` file metadata, primary geometry columns, CRS and bounding metadata, and semantic-version compatibility rules ([GeoParquet 1.1.0 specification](https://geoparquet.org/releases/v1.1.0/)).
The GeoParquet project currently lists a 2.0.0 release candidate rather than a final 2.0 release ([GeoParquet releases](https://geoparquet.org/releases/)).
FlatGeobuf defines a binary feature stream with a header, an optional packed Hilbert R-tree spatial index, and feature data; its major and patch format versions are encoded in the magic bytes ([FlatGeobuf specification](https://flatgeobuf.org/)).
The official implementation describes FlatGeobuf as lossless, streamable, random-access capable, and distinct from lossy render-oriented vector tiles ([FlatGeobuf repository](https://github.com/flatgeobuf/flatgeobuf)).

**Recommendation.**
Pin GeoParquet 1.1.0 as the single normalized vector table format for Stage 1.
Use one file per logical source layer or transformation boundary, stable row ordering by a documented feature key, explicit CRS, explicit geometry type, and a compiler-owned schema.
Retain original source bytes because normalization can change source ordering, geometry encoding, or field representation even when feature meaning is preserved.
Allow FlatGeobuf at adapter boundaries where browser range access or simple feature streaming is materially useful, but do not require both formats in every pack.
Reconsider GeoParquet 2 only after a final specification and reader compatibility proof exist.

### COPC, LAZ, and LAS

**Researched fact.**
COPC 1.0 is a LAZ 1.4 file whose points are organized in a clustered octree, allowing a normal variable-chunk LAZ reader to consume it sequentially and a COPC-aware reader to request spatial subsets ([COPC 1.0 specification](https://copc.io/)).
LAS is an ASPRS point-cloud exchange specification, and LASzip documents LAZ as lossless compression whose decompression can reproduce the LAS bytes bit for bit ([ASPRS LAS standards page](https://community.asprs.org/leadership-restricted/leadership-content/public-documents/standards) and [LASzip repository](https://github.com/LASzip/LASzip)).
The LASzip reference library is Apache-2.0, while the source dataset's licence remains independent of the compression implementation ([LASzip repository](https://github.com/LASzip/LASzip)).

**Recommendation.**
Retain acquired LAS or LAZ exactly as downloaded and checksum it before any normalization.
Create COPC 1.0 as a derived artifact only when spatial subset processing is needed.
Pin the COPC/LAZ writer, chunking, scale and offset, point record format, CRS VLRs, classification handling, extra-byte policy, and point ordering.
Core builds without point-cloud coverage must declare the quality cells as `derived`, `procedural`, or `unavailable`; they must not manufacture a measured-LiDAR provenance class.

## Deterministic portable archive

**Researched fact.**
PKWARE publishes the ZIP APPNOTE as the cross-platform interoperability specification for ZIP, including ZIP64 ([PKWARE APPNOTE](https://support.pkware.com/pkzip/appnote)).
Archive timestamps, filesystem enumeration order, ownership, permissions, and other metadata are common causes of non-reproducible bytes ([Reproducible Builds timestamp guidance](https://reproducible-builds.org/docs/timestamps/), [stable-input guidance](https://reproducible-builds.org/docs/stable-inputs/), and [metadata-stripping guidance](https://reproducible-builds.org/docs/stripping-unreproducible-information/)).
RFC 8785 defines a canonical JSON representation with deterministic property sorting and primitive serialization for repeatable hashing and signing ([JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)).

**Recommendation.**
The Stage 1 export extension should be `.worldpack.zip`, with ZIP64 enabled and every member stored without archive-level compression.
The exporter must apply all of these rules:

1. Include files only, with no directory entries, symlinks, hard links, devices, absolute paths, `..` segments, duplicate names, or platform resource forks.
2. Normalize paths to UTF-8 NFC, `/` separators, and a compiler-defined portable character set.
3. Order entries by unsigned UTF-8 byte order, independent of locale and filesystem enumeration.
4. Use ZIP method `STORE`, fixed DOS date/time fields for `1980-01-01 00:00:00` written without host-timezone conversion, fixed creator/version fields, fixed file mode, and no optional extra fields except those required by ZIP64.
5. Generate RFC 8785 canonical JSON before checksumming and reject non-finite numbers.
6. Put SHA-256, byte size, media type, schema or format version, and logical role for every member in `checksums.json`.
7. Verify member paths and declared uncompressed sizes before extraction to prevent traversal and decompression-bomb behavior.
8. Derive pack identity from the canonical manifest plus required artifact inventory, not from the archive wrapper checksum.
9. Still require two clean exports to be byte-identical and record the archive SHA-256 as transfer evidence.

Storing entries avoids compressor-version drift and pointless recompression of already compressed GLB textures, PMTiles payloads, COGs, Parquet, and LAZ/COPC.
The pack remains a normal verified directory after import, so runtime range access does not depend on random access through the outer ZIP.

## Public source candidates

The fixed route extents used for route-level checks are:

| World | Fixed route extent in WGS84 |
| --- | --- |
| Tokyo | `139.7621503752,35.6304153521,139.7926757578,35.6929744408` |
| Banff/Kananaskis | `-115.6209958624,51.1428707745,-115.5594700109,51.1825599242` |
| Ucluelet | `-125.5701821577,48.9307254273,-125.5288903043,48.9460014459` |

### Cross-world vector and imagery floor

**OpenStreetMap vector data - confirmed collection availability, local completeness unproved.**
OpenStreetMap publishes global road, path, trail, building, and other vector features under ODbL; copying, adapting, and distributing the database requires attribution, and public distribution of an altered or derived database carries share-alike obligations ([OSM copyright and licence](https://www.openstreetmap.org/copyright) and [OSMF legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)).
OSMF lists planet dumps, extracts, mirrors, and Overpass as data-acquisition routes, and explicitly distinguishes open data from the capacity-limited public tile service ([OSMF acquisition guidance](https://osmfoundation.org/wiki/How_To_Get_OpenStreetMap_Data) and [OSM copyright page](https://www.openstreetmap.org/copyright)).

Recommendation: acquire an immutable route-corridor PBF or documented Overpass response rather than rendered `openstreetmap.org` tiles.
Keep OSM-derived GeoParquet and PMTiles as a separable ODbL database layer, include `OpenStreetMap and contributors` attribution and the licence link in both pack metadata and interactive display, and retain the exact extraction query, timestamp, replication sequence or snapshot identifier, and source checksum.

**Copernicus Sentinel imagery - confirmed global acquisition option, scene quality conditional.**
The Copernicus Data Space makes Sentinel data available worldwide on a free, full, and open basis under the Sentinel Data Legal Notice ([Data Space terms](https://dataspace.copernicus.eu/terms-and-conditions) and [Sentinel Data Legal Notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)).
The legal notice permits reproduction, distribution, communication, adaptation, modification, and combination, with the notice `Copernicus Sentinel data [Year]` or `Contains modified Copernicus Sentinel data [Year]` as applicable ([Sentinel Data Legal Notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)).

Recommendation: use a downloaded Sentinel product as a retainable imagery floor for all three worlds, never a transient rendered portal tile.
Scene resolution, acquisition date, cloud, snow, shadow, tide, and forest canopy must be evaluated per route before accepting it as a visual source.

### Tokyo

| Source class | Evidence | Coverage and retention assessment |
| --- | --- | --- |
| Terrain | GSI's Fundamental Geospatial Data download service publishes registered-user downloads of 1 m, 5 m, and 10 m DEM products; DEM1A and DEM5A are derived from airborne laser survey, while DEM5B/5C are photogrammetric ([download service](https://service.gsi.go.jp/kiban/) and [DEM product help](https://service.gsi.go.jp/kiban/app/help/)). | **Coverage and legal admission conditional.** Select the exact route meshes, then record an asset-specific Survey Act approval decision or documented exception before retaining, transforming, or packaging the data. A download alone is not admission evidence. |
| Structures | MLIT's Project PLATEAU portal lists Tokyo's 23 wards and provides 3D city models generated from survey sources; the models are downloadable open data and may be used commercially ([PLATEAU catalogue](https://front.geospatial.jp/plateau_portal_site/) and [MLIT PLATEAU FAQ](https://www.mlit.go.jp/plateau/faq/)). | **Confirmed at city/ward level, conditional at asset level.** Acquire CityGML for the intersecting wards and preserve each dataset README, source-material list, version, and selected licence. |
| Roads, paths, trails | OSM has global extract acquisition under ODbL, while GSI describes its national Electronic National Land Base Map as vector coverage of roads, buildings, railways, vegetation, cliffs, and structures ([OSMF acquisition guidance](https://osmfoundation.org/wiki/How_To_Get_OpenStreetMap_Data) and [GSI map-information description](https://www.gsi.go.jp/kibanjoho/mapinfo_what.html)). | **OSM collection confirmed; local completeness conditional.** Use OSM first for the redistributable Core vector layer and evaluate GSI survey-result procedures before ingesting GSI vectors. |
| Imagery | GSI permits anyone to download 400 dpi aerial photographs from its map/photo service, and downloaded photographs can be reused with source attribution without an approval application ([GSI aerial-photo page](https://web1.gsi.go.jp/CHIRIKYOUIKU/syasin.html) and [service terms](https://service.gsi.go.jp/map-photos/app/help)). | **Conditional.** These are source photographs, not automatically a seamless current orthophoto; retain image identifiers and capture metadata, and use Sentinel when no suitable source-cleared mosaic can be produced. |
| Raw LiDAR | GSI documents that some DEMs are laser-derived, but this spike found no official raw point-cloud download covering the fixed corridor ([GSI DEM product help](https://service.gsi.go.jp/kiban/app/help/)). | **Not verified.** Do not label PLATEAU geometry or GSI DEM cells as raw LiDAR point-cloud evidence. |

GSI content is generally governed by Japan's Public Data License 1.0 and requires source citation plus an edited-content notice, but GSI warns that third-party content and Basic Survey Results can have additional terms or Survey Act procedures ([GSI terms](https://www.gsi.go.jp/ENGLISH/page_e30286.html) and [GSI survey-result procedure](https://www.gsi.go.jp/LAW/2930-index.html)).
PLATEAU says its 3D city models are available under open licences including PDL 1.0, CC BY 4.0, ODC BY, and ODbL, and its site policy requires attribution and disclaims endorsement ([PLATEAU FAQ](https://www.mlit.go.jp/plateau/faq/) and [PLATEAU site policy](https://www.mlit.go.jp/plateau/site-policy/)).

Recommendation: record and comply with the licence declared by the selected PLATEAU asset, and admit only an asset whose declared licence meets the pack's retention, transformation, and redistribution policy.
No GSI tile, DEM, or survey result enters any sealed pack until the adapter records its asset-specific legal category and required approval or explicit exception.

### Banff/Kananaskis

| Source class | Evidence | Coverage and retention assessment |
| --- | --- | --- |
| Terrain floor | Copernicus DEM GLO-30 is a 30 m global digital surface model whose licence grants worldwide, unlimited-time reproduction, distribution, public communication, adaptation, modification, and combination rights ([Copernicus DEM GLO-30 licence](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf)). | **Confirmed global floor.** Retention and redistribution are allowed when the required source, modified-data, no-liability, and non-endorsement notices are carried forward. The 30 m surface grid is not assumed to satisfy later high-relief collision or visual-fidelity gates. |
| Canada-enriched terrain | NRCan's 30 m MRDEM is a CanElevation DTM/DSM product derived from Copernicus WorldDEM-30 and HRDEM and exposed through STAC, VRT, and streaming services ([MRDEM catalogue](https://open.canada.ca/data/en/dataset/18752265-bda3-498c-a4ba-9dfe68cb98da)). | **Conditional.** Before retaining a selected underlying object, the adapter must confirm an authorized acquisition path, checksum the object, and capture the product-specific DLR/Airbus/Copernicus credit and no-liability notice because OGL-Canada excludes third-party rights. |
| High-resolution terrain | NRCan publishes HRDEM DTM/DSM GeoTIFF, STAC access, and footprint services for LiDAR- or imagery-derived projects ([HRDEM catalogue](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995)). | **Not verified for this route.** The official [current HRDEM footprint query](https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/coverage_HRDEM_en/MapServer/5/query?where=1%3D1&geometry=-115.6209958624%2C51.1428707745%2C-115.5594700109%2C51.1825599242&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=pjson) returned no intersecting project on 2026-08-26. |
| Roads, paths, trails, and sparse structures | OSM provides the global vector acquisition and ODbL redistribution path described above ([OSM copyright and licence](https://www.openstreetmap.org/copyright)). | **Collection confirmed; local completeness conditional.** Verify trail continuity, bridges, tunnels, and building footprints against the recorded route and declared gaps. |
| Imagery | Copernicus Sentinel is the confirmed retainable global source described above ([Data Space terms](https://dataspace.copernicus.eu/terms-and-conditions)). | **Conditional at scene level.** Mountain shadow, snow, cloud, and acquisition season are quality gates. |
| Raw LiDAR | NRCan publishes downloadable CanElevation LAS point clouds and a queryable project/tiles index ([CanElevation point-cloud catalogue](https://open.canada.ca/data/en/dataset/7069387e-9986-4297-9f55-0288e9676947)). | **Not verified for this route.** The official [current project query](https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/lidar_point_cloud_canelevation_en/MapServer/0/query?where=1%3D1&geometry=-115.6209958624%2C51.1428707745%2C-115.5594700109%2C51.1825599242&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=pjson) returned no intersecting project on 2026-08-26. |

The Open Government Licence - Canada permits worldwide, royalty-free, perpetual copying, modification, publication, adaptation, distribution, and commercial use, but requires attribution and excludes third-party rights, personal information, official marks, and implied endorsement ([OGL-Canada 2.0](https://open.canada.ca/en/open-government-licence-canada)).
Its versioning clause says use is governed by the licence in force when the information was accessed, so the source inventory must retain the acquisition date and exact licence version ([OGL-Canada 2.0](https://open.canada.ca/en/open-government-licence-canada)).

Recommendation: Stage 1 Core may compile Banff terrain from directly licensed Copernicus DEM GLO-30 plus procedural detail, with the resolution and physics quality declared honestly.
MRDEM may replace that floor only after its underlying object, third-party rights, and required notices pass the per-asset admission gate.
Do not block the compiler-foundation proof on unavailable LiDAR, and do not claim a Detailed or Archival terrain tier until a route-intersecting retainable high-resolution source is found.

### Ucluelet

| Source class | Evidence | Coverage and retention assessment |
| --- | --- | --- |
| Terrain and raw LiDAR | The Province of British Columbia publishes LidarBC LAZ point clouds and LiDAR-derived products under OGL-BC ([LidarBC programme page](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/lidarbc) and [official portal item](https://www.arcgis.com/home/item.html?id=c2967cee749b4bdbac5e7c62935ca167)). | **Confirmed route-bbox intersection; complete route coverage still needs a geometry-union check.** The official route-bbox query returns four 2019 LAZ tiles in the [point-cloud index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/4/query?where=1%3D1&geometry=-125.5701821577%2C48.9307254273%2C-125.5288903043%2C48.9460014459&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=pjson) and one 2019 1 m DEM tile in the [DEM index](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/6/query?where=1%3D1&geometry=-125.5701821577%2C48.9307254273%2C-125.5288903043%2C48.9460014459&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=pjson), observed 2026-08-26. |
| Roads, paths, trails, and sparse structures | OSM provides the global vector acquisition and ODbL redistribution path described above ([OSM copyright and licence](https://www.openstreetmap.org/copyright)). | **Collection confirmed; local completeness conditional.** Forest trails, coastline crossings, bridges, and sparse structures need route-level review. |
| Imagery | Copernicus Sentinel is the confirmed retainable global source described above, while the B.C. base-map store describes provincial orthophotos and air photos as purchasable products rather than a blanket open-data grant ([Data Space terms](https://dataspace.copernicus.eu/terms-and-conditions) and [B.C. Base Map Online Store](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/base-map-online-store)). | **Sentinel conditional at scene level; B.C. orthophoto not open by default.** Do not vendor a provincial orthophoto without a selected product licence that explicitly permits retention and redistribution. |

OGL-BC datasets are free for personal or commercial use when the catalogue record actually declares that licence, while restricted B.C. datasets require separate authorization to reproduce or redistribute ([B.C. catalogue guidance](https://www2.gov.bc.ca/gov/content/data/finding-and-sharing/bc-data-catalogue/find)).
OGL-BC 2.0 grants worldwide, royalty-free, perpetual copying, modification, publication, adaptation, distribution, and commercial use, but requires attribution and excludes third-party rights, personal information, official marks, and implied endorsement ([Open Government Licence - British Columbia](https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc)).
The LidarBC portal itself declares its released data to be OGL-BC, and the provincial programme identifies LAZ and derived products as freely downloadable and usable ([official LidarBC portal item](https://www.arcgis.com/home/item.html?id=c2967cee749b4bdbac5e7c62935ca167) and [LidarBC programme page](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/lidarbc)).

Recommendation: Ucluelet should be the first real point-cloud adapter proof.
Retain the four source LAZ objects exactly, record the portal feature metadata and accuracy report, derive COPC and COG deterministically, and keep the source year, 8 points-per-square-metre density, UTM zone 10 projection, CGVD2013 vertical datum, and classifications from the index in provenance.
Freeze the complete query response, returned object URLs, response checksum, and each downloaded object's checksum because a live index result is coverage evidence, not an immutable source inventory.

## Licence and retention contract

Every acquired asset must have a machine-readable decision before it can contribute to a sealed pack:

| Field | Required meaning |
| --- | --- |
| `source_uri` | Stable dataset or asset URI, not only a viewer URL |
| `acquired_at` | UTC acquisition timestamp used as evidence, not as a deterministic build input |
| `source_version` | Dataset edition, scene ID, survey year, replication sequence, or immutable object version |
| `source_sha256` | Checksum of the exact downloaded bytes before transformation |
| `licence_id` and `licence_uri` | Exact licence and version that applied at acquisition |
| `licence_evidence_sha256` | Checksum of a retained licence/README snapshot when redistribution of that evidence is permitted |
| `attribution` | Required human-readable credit and modified-content notice |
| `retention` | Whether local preservation is allowed |
| `derivatives` | Whether transformation is allowed and under what notice |
| `redistribution` | `allowed`, `restricted`, `private_only`, or `unknown` |
| `public_use_obligations` | Share-alike, source offer, attribution placement, or other triggered duties |
| `third_party_rights` | Known exclusions or asset-level override |
| `decision` | `admit`, `private_pack_only`, `metadata_only`, or `reject` with reason |

Retention and redistribution are separate decisions.
A locally retainable asset may support a private World Pack while being excluded from a portable redistributable archive.
An `unknown` redistribution decision fails closed.
Attribution must survive normalization, deduplication, export, import, cinematic render, and migration.

## Stage 1 proof gates

The format decision is ready to implement only with these bounded proofs:

1. Produce two Core packs from identical normalized inputs on clean checkouts and prove byte-identical canonical JSON, GLB, PMTiles, COG, GeoParquet, and ZIP outputs.
2. Validate GLB with the Khronos validator, 3D Tiles against the 1.1 schema and local-reference policy, COG structure with a pinned validator, GeoParquet metadata against the 1.1.0 schema, PMTiles directory integrity, and COPC when present.
3. Export a ZIP64 pack containing at least one file larger than 4 GiB and import it on a clean machine without network access, credentials, symlinks, or original absolute paths.
4. Tamper with one member, one manifest path, one licence decision, and one archive entry path and prove verification rejects each case before installation.
5. Rebuild PMTiles, GLB, collision, and manifests from retained normalized sources without contacting OSM, GSI, PLATEAU, Copernicus, NRCan, or LidarBC.
6. Run source-adapter acceptance against Tokyo PLATEAU plus a legally admitted GSI DEM or synthetic terrain fixture, Banff Copernicus DEM GLO-30 plus OSM and Sentinel, and the intersecting Ucluelet LidarBC tiles.
7. Keep Banff high-resolution terrain/LiDAR and Tokyo raw LiDAR as explicit source gaps until direct route-level evidence changes their status.

These choices prove an open, repairable compiler foundation.
They do not by themselves prove the three complete World Packs, offline traversal, physical stability, visual parity, or deterministic cinema required by the overall goal.
