// SPIKE (lab only, not a feature): Google's Photorealistic 3D Tiles drawn as
// a line drawing by a post-process pass over our own Cesium render.
//
// Lines come from three places, each read per pixel from this frame only:
//  - depth jumps (silhouettes: a roof against the street behind it);
//  - normal changes (creases: building corners, roof ridges), with normals
//    rebuilt from the depth buffer;
//  - edges in the photo texture itself (windows, doors, signs), finer and
//    fading with distance so far districts do not turn to noise.
// Surfaces are paper, shaded a little by which way they face. `u_reveal`
// blends to the real colour everywhere; `u_corridor` lets colour flood out
// along the route, a distance measured on the ground plane around it.

export const MAX_ROUTE_POINTS = 64;

export const SKETCH_REAL_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_reveal;
uniform float u_corridor;
uniform float u_radius;
uniform float u_detail;
uniform mat4 u_eyeToLocal;
uniform vec2 u_route[${MAX_ROUTE_POINTS}];
uniform float u_routeCount;
in vec2 v_textureCoordinates;

// Eye-space position of a pixel, the way Cesium's own ambient occlusion
// rebuilds it (czm_readDepth undoes the logarithmic depth).
vec3 eyeAt(vec2 uv) {
  float depth = czm_readDepth(depthTexture, uv);
  vec4 eye = czm_inverseProjection * vec4(uv * 2.0 - 1.0, depth, 1.0);
  return eye.xyz / eye.w;
}

float isSky(vec2 uv) {
  return step(1.0, texture(depthTexture, uv).r);
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 colour = texture(colorTexture, uv).rgb;
  vec3 paper = vec3(0.985, 0.98, 0.965);
  if (isSky(uv) > 0.5) {
    out_FragColor = vec4(mix(paper, colour, u_reveal), 1.0);
    return;
  }
  vec2 px = 1.0 / czm_viewport.zw;
  vec3 p = eyeAt(uv);
  float dist = length(p);

  // Lines stay about the same width on screen near by, thinner far off.
  float reach = mix(1.6, 1.0, smoothstep(80.0, 600.0, dist));
  vec2 dx = vec2(px.x * reach, 0.0);
  vec2 dy = vec2(0.0, px.y * reach);
  vec3 pl = eyeAt(uv - dx);
  vec3 pr = eyeAt(uv + dx);
  vec3 pd = eyeAt(uv - dy);
  vec3 pu = eyeAt(uv + dy);

  // Silhouettes: neighbours much nearer or further than a flat surface allows.
  float depthJump = max(max(abs(length(pl) - dist), abs(length(pr) - dist)), max(abs(length(pd) - dist), abs(length(pu) - dist)));
  float silhouette = smoothstep(0.006, 0.016, depthJump / dist);

  // Creases: the surface normal turns sharply between neighbours.
  vec3 n = normalize(cross(pr - pl, pu - pd));
  vec3 nl = normalize(cross(p - eyeAt(uv - 2.0 * dx), pu - pd));
  vec3 nr = normalize(cross(eyeAt(uv + 2.0 * dx) - p, pu - pd));
  vec3 nd = normalize(cross(pr - pl, p - eyeAt(uv - 2.0 * dy)));
  vec3 nu = normalize(cross(pr - pl, eyeAt(uv + 2.0 * dy) - p));
  float turn = 1.0 - min(min(dot(n, nl), dot(n, nr)), min(dot(n, nd), dot(n, nu)));
  float crease = smoothstep(0.2, 0.45, turn) * (1.0 - smoothstep(900.0, 2500.0, dist));

  // Drawn detail from the photo: a Sobel on brightness, only strong edges,
  // fading with distance so it never becomes grain.
  float tl = luma(texture(colorTexture, uv + vec2(-px.x, px.y)).rgb);
  float tc = luma(texture(colorTexture, uv + vec2(0.0, px.y)).rgb);
  float tr = luma(texture(colorTexture, uv + vec2(px.x, px.y)).rgb);
  float ml = luma(texture(colorTexture, uv + vec2(-px.x, 0.0)).rgb);
  float mr = luma(texture(colorTexture, uv + vec2(px.x, 0.0)).rgb);
  float bl = luma(texture(colorTexture, uv + vec2(-px.x, -px.y)).rgb);
  float bc = luma(texture(colorTexture, uv + vec2(0.0, -px.y)).rgb);
  float br = luma(texture(colorTexture, uv + vec2(px.x, -px.y)).rgb);
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float detail = smoothstep(0.2, 0.5, length(vec2(gx, gy))) * (1.0 - smoothstep(250.0, 1400.0, dist)) * u_detail;

  float ink = clamp(max(max(silhouette, crease), detail * 0.7), 0.0, 1.0);
  // Paper, shaded a little by which way the surface faces the sky.
  float facing = abs(dot(n, normalize((czm_view * vec4(0.0, 0.0, 1.0, 0.0)).xyz)));
  vec3 surface = paper * mix(0.9, 1.0, facing);
  vec3 sketch = mix(surface, vec3(0.11, 0.11, 0.12), ink);

  // Colour: everywhere by u_reveal, and along the route within u_radius.
  float reveal = u_reveal;
  if (u_corridor > 0.5) {
    vec2 here = (u_eyeToLocal * vec4(p, 1.0)).xy;
    float best = 1e9;
    for (int i = 1; i < ${MAX_ROUTE_POINTS}; i++) {
      if (float(i) >= u_routeCount) break;
      vec2 a = u_route[i - 1];
      vec2 b = u_route[i];
      vec2 ab = b - a;
      float t = clamp(dot(here - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      best = min(best, length(here - (a + t * ab)));
    }
    reveal = max(reveal, 1.0 - smoothstep(u_radius * 0.7, u_radius, best));
  }
  // The real colour keeps a whisper of ink as it floods in, then lets it go.
  vec3 real = mix(colour, colour * (1.0 - 0.35 * ink), 1.0 - reveal);
  out_FragColor = vec4(mix(sketch, real, smoothstep(0.0, 1.0, reveal)), 1.0);
}
`;
