// A deliberately synthetic, textured test tile. Never imported by application code.
// This exercises the real GLTF/3D Tiles/WebGL pipeline, not Google's imagery service.
const join = (...parts: Uint8Array[]) => Buffer.concat(parts.map((part) => Buffer.from(part)));
const pad = (buffer: Buffer, byte = 0) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, byte)]);

export function syntheticGlb(): Buffer {
  const positions = Buffer.alloc(48);
  [-4000, 1000, 4000, 4000, 1000, 4000, 4000, 1000, -4000, -4000, 1000, -4000].forEach((n, i) => positions.writeFloatLE(n, i * 4));
  const uv = Buffer.alloc(32);
  [0, 0, 1, 0, 1, 1, 0, 1].forEach((n, i) => uv.writeFloatLE(n, i * 4));
  const indices = Buffer.alloc(12);
  [0, 1, 2, 0, 2, 3].forEach((n, i) => indices.writeUInt16LE(n, i * 2));
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAL0lEQVR4nGM8vKWeAQY23L0BZwcoa2AVZ2IgEdBeAwsx7kYWH4x+IMbdo/FAcw0AdCYZgX9n2e0AAAAASUVORK5CYII=", "base64");
  const binary = pad(join(positions, uv, indices, image));
  const json = pad(Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "goDiesel synthetic renderer test" },
    extensionsUsed: ["KHR_materials_unlit"], extensionsRequired: ["KHR_materials_unlit"],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ extensions: { KHR_materials_unlit: {} }, doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0 }], images: [{ bufferView: 3, mimeType: "image/png" }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 32 }, { buffer: 0, byteOffset: 80, byteLength: 12 }, { buffer: 0, byteOffset: 92, byteLength: image.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-4000, 1000, -4000], max: [4000, 1000, 4000] }, { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" }, { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" }],
  })), 32);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  const chunk = (data: Buffer, kind: number) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(kind, 4); return join(h, data); };
  return join(header, chunk(json, 0x4e4f534a), chunk(binary, 0x004e4942));
}

export function syntheticTileset() {
  const lat = 51 * Math.PI / 180, lng = -114 * Math.PI / 180;
  const n = 6378137 / Math.sqrt(1 - 0.00669437999014 * Math.sin(lat) ** 2);
  return {
    asset: { version: "1.0", gltfUpAxis: "Y" }, geometricError: 0,
    root: {
      transform: [-Math.sin(lng), Math.cos(lng), 0, 0, -Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat), 0, Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat), 0, n * Math.cos(lat) * Math.cos(lng), n * Math.cos(lat) * Math.sin(lng), n * (1 - 0.00669437999014) * Math.sin(lat), 1],
      boundingVolume: { box: [0, 0, 1000, 4000, 0, 0, 0, 4000, 0, 0, 0, 20] },
      geometricError: 0, refine: "REPLACE", content: { uri: "fixture.glb?session=synthetic-test-session" },
    },
  };
}

function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let n = value >>> 0;
  while (n > 127) { bytes.push((n & 127) | 128); n >>>= 7; }
  bytes.push(n); return new Uint8Array(bytes);
}
const integer = (field: number, value: number) => join(varint(field * 8), varint(value));
const bytes = (field: number, data: Uint8Array) => join(varint(field * 8 + 2), varint(data.length), data);
const text = (field: number, value: string) => bytes(field, Buffer.from(value));
const zigzag = (value: number) => (value << 1) ^ (value >> 31);
export function syntheticRoadTile(z: number, x: number, y: number) {
  const point = (lat: number, lng: number) => [Math.round(((lng + 180) / 360 * 2 ** z - x) * 4096), Math.round(((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z - y) * 4096)];
  const a = point(51, -114.035), b = point(51, -114), c = point(51, -113.965);
  const geometry = [9, zigzag(a[0]), zigzag(a[1]), 18, zigzag(b[0] - a[0]), zigzag(b[1] - a[1]), zigzag(c[0] - b[0]), zigzag(c[1] - b[1])];
  const feature = join(integer(1, 1), bytes(2, join(varint(0), varint(0))), integer(3, 2), bytes(4, join(...geometry.map(varint))));
  return bytes(3, join(text(1, "transportation_name"), bytes(2, feature), text(3, "name"), bytes(4, text(1, "Synthetic road — test only")), integer(5, 4096), integer(15, 2)));
}
