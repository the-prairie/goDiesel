// Her route close up: drawn on the ground along the streets she ran,
// depth-tested so buildings in front hide it, instead of a flat stripe laid
// over everything. Segments are in the units of the tile the route starts
// in (a route running past that tile's edge simply has larger numbers), so
// the edge layer draws them with that tile's matrix.

/** How far above the ground the route is drawn, so the ground does not hide it. */
export const ROUTE_LIFT_M = 0.6;

export function routeOnGround(lines: readonly (readonly [number, number][])[], zoom: number, extent: number) {
  const n = 2 ** zoom;
  const toWorld = ([lng, lat]: readonly [number, number]): [number, number] => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  const first = lines.find((line) => line.length > 0)?.[0];
  if (!first) return { key: `${zoom}/0/0`, segments: new Float32Array() };
  const [wx, wy] = toWorld(first);
  const [tx, ty] = [Math.floor(wx), Math.floor(wy)];
  const out: number[] = [];
  for (const line of lines) {
    const points = line.map((point) => {
      const [x, y] = toWorld(point);
      return [(x - tx) * extent, (y - ty) * extent];
    });
    for (let i = 1; i < points.length; i += 1) out.push(points[i - 1][0], points[i - 1][1], ROUTE_LIFT_M, points[i][0], points[i][1], ROUTE_LIFT_M);
  }
  return { key: `${zoom}/${tx}/${ty}`, segments: new Float32Array(out) };
}
