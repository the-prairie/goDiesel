// Google's Photorealistic 3D Tiles drawn as the sketch, by a post-process
// pass over our own Cesium render (display only: nothing is read back,
// stored or traced; the owner reports Google allows this shader).
//
// Round 4, towards the drawn city's ruled lines:
//  - the frame is rendered at the screen's own pixel density (up to 2x) and
//    smoothed by FXAA after this pass, so lines are not stair-stepped;
//  - an outline needs both a jump in depth and a bend in it (its second
//    difference), so a smooth slope (a street seen at a low angle) and a
//    small lump draw nothing and only a real step does, on smooth ramps;
//  - creases compare normals averaged over a wider kernel, so the mesh's
//    small lumps do not read as corners;
//  - the photo's own edges add only faint detail, close by;
//  - surfaces are shaded like the drawn city: roofs paper white, walls a
//    shade darker by which way they face.
// Colour comes back by `u_flood` everywhere (the jump) and within `u_radius`
// metres of her routes (the corridor), measured on the ground.

import { MAX_SEGMENTS } from "@/labs/sketch/sketch-real-corridor";

export const SKETCH_REAL_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_flood;
uniform float u_radius;
uniform float u_soft;
uniform mat4 u_eyeToLocal;
uniform vec4 u_segments[${MAX_SEGMENTS}];
uniform float u_segmentCount;
uniform vec3 u_paper;
uniform vec3 u_ink;
in vec2 v_textureCoordinates;

// Eye-space position of a pixel, the way Cesium's own ambient occlusion
// rebuilds it (czm_readDepth undoes the logarithmic depth).
vec3 eyeAt(vec2 uv) {
  float depth = czm_readDepth(depthTexture, uv);
  vec4 eye = czm_inverseProjection * vec4(uv * 2.0 - 1.0, depth, 1.0);
  return eye.xyz / eye.w;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// A normal from neighbours 'k' pixels away: the wider, the less it follows lumps.
vec3 normalAt(vec2 uv, vec2 px, float k) {
  vec3 l = eyeAt(uv - vec2(px.x * k, 0.0));
  vec3 r = eyeAt(uv + vec2(px.x * k, 0.0));
  vec3 d = eyeAt(uv - vec2(0.0, px.y * k));
  vec3 u = eyeAt(uv + vec2(0.0, px.y * k));
  return normalize(cross(r - l, u - d));
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec3 colour = texture(colorTexture, uv).rgb;
  if (texture(depthTexture, uv).r >= 1.0) {
    out_FragColor = vec4(mix(u_paper, colour, u_flood), 1.0);
    return;
  }
  vec2 px = 1.0 / czm_viewport.zw;
  vec3 p = eyeAt(uv);
  float dist = length(p);

  // Outlines: the second difference of distance across the pixel, so a
  // steady slope cancels and only a step remains; inked on the near side.
  float dl = length(eyeAt(uv - vec2(px.x, 0.0)));
  float dr = length(eyeAt(uv + vec2(px.x, 0.0)));
  float dd = length(eyeAt(uv - vec2(0.0, px.y)));
  float du = length(eyeAt(uv + vec2(0.0, px.y)));
  float bend = max(dl + dr - 2.0 * dist, du + dd - 2.0 * dist);
  float jump = max(max(dl, dr), max(dd, du)) - dist;
  // A real step jumps and bends; a slope only jumps; a lump only bends a little.
  float outline = smoothstep(0.006, 0.018, jump / dist) * smoothstep(0.0015, 0.006, bend / dist);

  // Creases: wide-kernel normals on either side turn sharply (a corner, a ridge).
  vec3 n = normalAt(uv, px, 2.0);
  vec3 nl = normalAt(uv - vec2(3.0 * px.x, 0.0), px, 2.0);
  vec3 nr = normalAt(uv + vec2(3.0 * px.x, 0.0), px, 2.0);
  vec3 nd = normalAt(uv - vec2(0.0, 3.0 * px.y), px, 2.0);
  vec3 nu = normalAt(uv + vec2(0.0, 3.0 * px.y), px, 2.0);
  float turn = 1.0 - min(min(dot(nl, nr), dot(nd, nu)), 1.0);
  float crease = smoothstep(0.4, 0.7, turn) * (1.0 - smoothstep(600.0, 1600.0, dist)) * 0.6;

  // Faint drawn detail from the photo's strongest edges, only close by.
  float gx = luma(texture(colorTexture, uv + vec2(px.x, 0.0)).rgb) - luma(texture(colorTexture, uv - vec2(px.x, 0.0)).rgb);
  float gy = luma(texture(colorTexture, uv + vec2(0.0, px.y)).rgb) - luma(texture(colorTexture, uv - vec2(0.0, px.y)).rgb);
  float detail = smoothstep(0.3, 0.55, length(vec2(gx, gy))) * (1.0 - smoothstep(60.0, 180.0, dist)) * 0.3;

  float ink = clamp(max(max(outline, crease), detail), 0.0, 1.0);

  // Shaded like the drawn city: what faces the sky is paper, walls a shade
  // darker by which way they face the light.
  vec3 up = normalize((czm_view * vec4(normalize(czm_viewerPositionWC), 0.0)).xyz);
  float sky = dot(n, up);
  vec3 light = normalize((czm_view * vec4(normalize(cross(normalize(czm_viewerPositionWC), vec3(0.0, 0.0, 1.0))), 0.0)).xyz);
  float wall = 0.84 + 0.1 * abs(dot(n, light));
  float shade = mix(wall, 1.0, smoothstep(0.55, 0.85, sky));
  vec3 sketch = mix(u_paper * shade, u_ink, ink);

  float reveal = u_flood;
  if (u_radius > 0.0) {
    vec2 here = (u_eyeToLocal * vec4(p, 1.0)).xy;
    float best = 1e9;
    for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
      if (float(i) >= u_segmentCount) break;
      vec2 a = u_segments[i].xy;
      vec2 b = u_segments[i].zw;
      vec2 ab = b - a;
      float t = clamp(dot(here - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      best = min(best, length(here - (a + t * ab)));
    }
    // A sharp corridor, or a wash that fades over its outer half.
    float edge = mix(0.94, 0.5, u_soft);
    reveal = max(reveal, 1.0 - smoothstep(u_radius * edge, u_radius, best));
  }
  // The real colour keeps a whisper of ink as it floods in, then lets it go.
  vec3 real = mix(colour, colour * (1.0 - 0.3 * ink), 1.0 - reveal);
  out_FragColor = vec4(mix(sketch, real, smoothstep(0.0, 1.0, reveal)), 1.0);
}
`;
