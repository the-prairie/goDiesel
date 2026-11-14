// Google's Photorealistic 3D Tiles drawn as the sketch, by a post-process
// pass over our own Cesium render (display only: nothing is read back,
// stored or traced; the owner reports Google allows this shader).
//
// Tuned towards the drawn city's clean, ruled look: lines come mainly from
// depth jumps (outlines) and sharp creases (corners, ridges), one pixel
// wide, anti-aliased, and the photo's own edges add only a little drawn
// detail close by. Surfaces are paper, shaded a little by which way they
// face. Colour comes back by `u_flood` everywhere (the jump) and within
// `u_radius` metres of her routes (the corridor), measured on the ground.

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
  vec3 pl = eyeAt(uv - vec2(px.x, 0.0));
  vec3 pr = eyeAt(uv + vec2(px.x, 0.0));
  vec3 pd = eyeAt(uv - vec2(0.0, px.y));
  vec3 pu = eyeAt(uv + vec2(0.0, px.y));

  // Outlines: a neighbour much nearer or further than a flat surface allows.
  // Only the nearer side of a jump inks, so an outline is one pixel, not two.
  float jump = max(max(length(pl) - dist, length(pr) - dist), max(length(pd) - dist, length(pu) - dist));
  float outline = smoothstep(0.0035, 0.01, jump / dist);

  // Creases: the surface turns sharply (corners, ridges), close by only.
  vec3 n = normalize(cross(pr - pl, pu - pd));
  vec3 nr = normalize(cross(eyeAt(uv + vec2(2.0 * px.x, 0.0)) - p, pu - pd));
  vec3 nu = normalize(cross(pr - pl, eyeAt(uv + vec2(0.0, 2.0 * px.y)) - p));
  float turn = 1.0 - min(dot(n, nr), dot(n, nu));
  float crease = smoothstep(0.3, 0.55, turn) * (1.0 - smoothstep(900.0, 2200.0, dist));

  // A little drawn detail from the photo's strongest edges (windows, signs),
  // only close by, so it never becomes grain.
  float gx = luma(texture(colorTexture, uv + vec2(px.x, 0.0)).rgb) - luma(texture(colorTexture, uv - vec2(px.x, 0.0)).rgb);
  float gy = luma(texture(colorTexture, uv + vec2(0.0, px.y)).rgb) - luma(texture(colorTexture, uv - vec2(0.0, px.y)).rgb);
  float detail = smoothstep(0.25, 0.5, length(vec2(gx, gy))) * (1.0 - smoothstep(80.0, 350.0, dist)) * 0.5;

  float ink = clamp(max(max(outline, crease * 0.85), detail), 0.0, 1.0);
  float facing = abs(dot(n, normalize((czm_view * vec4(0.0, 0.0, 1.0, 0.0)).xyz)));
  vec3 sketch = mix(u_paper * mix(0.9, 1.0, facing), u_ink, ink);

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
