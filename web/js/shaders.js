// GLSL ES 3.00 sources. Everything is additive: the scene is drawn into an
// offscreen buffer, blurred twice for bloom, then composited over a nebula.

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBULA_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  vec2 p = uv * 2.4;
  float n1 = fbm(p);
  float n2 = fbm(p * 1.9 + vec2(3.7, 1.3));
  float cloud = smoothstep(0.34, 0.92, n1 * 0.85 + n2 * 0.35);
  vec3 base = mix(vec3(0.010, 0.014, 0.028), vec3(0.034, 0.048, 0.094), n1);
  vec3 tint = mix(vec3(0.16, 0.05, 0.34), vec3(0.02, 0.20, 0.28), n2);
  vec3 color = base + tint * cloud * 0.52;
  vec2 q = uv - 0.5;
  color *= 1.0 - dot(q, q) * 1.15;
  fragColor = vec4(color, 1.0);
}`;

export const STAR_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
layout(location = 3) in float aSeed;
layout(location = 4) in float aFocus;

uniform sampler2D uPositions;
uniform int uTexWidth;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uTime;
uniform float uReveal;
uniform float uSizeScale;

out vec2 vUv;
out vec3 vColor;
out float vAlpha;

void main() {
  ivec2 texel = ivec2(gl_InstanceID % uTexWidth, gl_InstanceID / uTexWidth);
  vec4 data = texelFetch(uPositions, texel, 0);
  vec4 clip = uViewProj * vec4(data.xyz, 1.0);
  vUv = aCorner;
  vColor = aColor;
  if (clip.w <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  float born = smoothstep(data.w, data.w + 0.05, uReveal);
  float distance = max(clip.w, 0.35);
  float size = aSize * uSizeScale * (0.35 + 0.65 * born) / distance;
  size *= 0.86 + 0.20 * aFocus;
  vec2 offset = aCorner * size * 2.0 / uViewport;
  gl_Position = clip;
  gl_Position.xy += offset * clip.w;
  float twinkle = 0.82 + 0.18 * sin(uTime * 1.6 + aSeed * 6.2831);
  vAlpha = born * aFocus * twinkle;
}`;

export const STAR_FS = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  float core = pow(max(0.0, 1.0 - r), 6.0);
  float halo = pow(max(0.0, 1.0 - r), 2.8) * 0.18;
  float flare = exp(-abs(vUv.y) * 26.0) * pow(max(0.0, 1.0 - abs(vUv.x)), 4.0)
              + exp(-abs(vUv.x) * 26.0) * pow(max(0.0, 1.0 - abs(vUv.y)), 4.0);
  vec3 color = vColor * (core * 1.9 + halo) + vec3(1.0, 0.97, 0.92) * flare * 0.18;
  fragColor = vec4(color, vAlpha);
}`;

export const EDGE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in float aStart;
layout(location = 2) in float aEnd;
layout(location = 3) in float aSegment;
layout(location = 4) in float aWeight;
layout(location = 5) in float aFocus;
layout(location = 6) in vec3 aColor;

uniform sampler2D uPositions;
uniform int uTexWidth;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uTime;
uniform float uReveal;
uniform float uThickness;
uniform float uMorph;

out float vSide;
out float vT;
out vec3 vColor;
out float vAlpha;
out float vSeed;

const float SEGMENTS = 10.0;

vec3 bezier(vec3 p0, vec3 p1, vec3 p2, float t) {
  float it = 1.0 - t;
  return it * it * p0 + 2.0 * it * t * p1 + t * t * p2;
}

void main() {
  ivec2 ta = ivec2(int(aStart) % uTexWidth, int(aStart) / uTexWidth);
  ivec2 tb = ivec2(int(aEnd) % uTexWidth, int(aEnd) / uTexWidth);
  vec4 da = texelFetch(uPositions, ta, 0);
  vec4 db = texelFetch(uPositions, tb, 0);

  vec3 middle = (da.xyz + db.xyz) * 0.5;
  float length3 = length(db.xyz - da.xyz);
  vec3 outward = length(middle) > 0.0001 ? normalize(middle) : vec3(0.0, 1.0, 0.0);
  vec3 universeControl = middle + outward * length3 * 0.14 + vec3(0.0, 0.0, length3 * 0.05);
  // Inside the brain a tract arches around the midline instead of bowing out
  // of the surface: the control point swirls around Y, inside the lobe.
  vec3 swirl = normalize(cross(vec3(0.0, 1.0, 0.0), db.xyz - da.xyz) + vec3(0.0001, 0.0001, 0.0001));
  vec3 brainControl = middle * 0.45 + swirl * length3 * 0.3 + outward * length3 * 0.04;
  vec3 control = mix(universeControl, brainControl, uMorph);

  float t0 = aSegment / SEGMENTS;
  float t1 = (aSegment + 1.0) / SEGMENTS;
  vec4 c0 = uViewProj * vec4(bezier(da.xyz, control, db.xyz, t0), 1.0);
  vec4 c1 = uViewProj * vec4(bezier(da.xyz, control, db.xyz, t1), 1.0);
  vSide = aCorner.y;
  vT = mix(t0, t1, aCorner.x);
  vColor = aColor;
  vSeed = aStart * 0.13 + aEnd * 0.07;

  if (c0.w <= 0.001 || c1.w <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }

  vec2 s0 = c0.xy / c0.w;
  vec2 s1 = c1.xy / c1.w;
  vec2 direction = normalize((s1 - s0) * uViewport + vec2(0.00001, 0.0));
  vec2 normal = vec2(-direction.y, direction.x);

  vec4 position = mix(c0, c1, aCorner.x);
  float pixels = (0.55 + 0.55 * aWeight) * uThickness * mix(1.0, 0.7, uMorph);
  position.xy += normal * aCorner.y * pixels * 2.0 / uViewport * position.w;
  gl_Position = position;

  float born = smoothstep(max(da.w, db.w), max(da.w, db.w) + 0.05, uReveal);
  float depthFade = clamp(2.8 / (0.7 + c0.w), 0.22, 1.0);
  // Long cross-vault arcs fade back so the local structure stays legible.
  // In the brain the same span is a tract, so it keeps its brightness.
  float spanFade = clamp(0.55 / (0.35 + length3), 0.18, 1.0);
  spanFade = mix(spanFade, 1.0, uMorph * 0.7);
  float fibreGain = mix(1.0, 1.75, uMorph);
  vAlpha = born * (0.05 + 0.11 * aWeight) * depthFade * spanFade * aFocus * fibreGain;
}`;

export const EDGE_FS = `#version 300 es
precision highp float;

in float vSide;
in float vT;
in vec3 vColor;
in float vAlpha;
in float vSeed;
out vec4 fragColor;

uniform float uTime;
uniform float uMorph;

void main() {
  float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
  float pulse = smoothstep(0.90, 1.0, sin(vT * 6.2831 - uTime * 0.85 + vSeed * 6.2831) * 0.5 + 0.5);
  vec3 color = vColor * mix(1.0, 1.25, uMorph) + vec3(1.0, 0.94, 0.86) * pulse * 0.35;
  fragColor = vec4(color, vAlpha * edge);
}`;

export const HALO_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aCenter;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aRadius;
layout(location = 4) in float aAlpha;

uniform mat4 uViewProj;
uniform float uScale;
uniform float uOpacity;

out vec2 vUv;
out vec3 vColor;
out float vAlpha;

void main() {
  vec4 clip = uViewProj * vec4(aCenter, 1.0);
  vUv = aCorner;
  vColor = aColor;
  if (clip.w <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  gl_Position = clip;
  gl_Position.xy += aCorner * aRadius * uScale * clip.w;
  vAlpha = aAlpha * uOpacity;
}`;

export const HALO_FS = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float cloud = pow(1.0 - d, 3.2) * 0.8 + smoothstep(0.45, 0.0, d) * 0.2;
  fragColor = vec4(vColor, cloud * vAlpha * 0.5);
}`;

export const THRESHOLD_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;

void main() {
  vec3 color = texture(uScene, vUv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float weight = smoothstep(0.26, 0.92, luminance);
  fragColor = vec4(color * weight, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uDirection;

void main() {
  vec3 sum = texture(uTexture, vUv).rgb * 0.227027;
  sum += (texture(uTexture, vUv + uDirection * 1.3846).rgb
        + texture(uTexture, vUv - uDirection * 1.3846).rgb) * 0.316216;
  sum += (texture(uTexture, vUv + uDirection * 3.2308).rgb
        + texture(uTexture, vUv - uDirection * 3.2308).rgb) * 0.070270;
  fragColor = vec4(sum, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBackground;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uParallax;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBrain;

void main() {
  vec2 uv = vUv;
  // The brain is lit like a specimen on black, not like a nebula.
  vec3 background = texture(uBackground, clamp(uv + uParallax * 0.03, 0.001, 0.999)).rgb * mix(1.0, 0.14, uBrain);
  vec3 scene = texture(uScene, uv).rgb;
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 color = background + scene + bloom * mix(0.5, 0.9, uBrain);

  // Gentle filmic curve keeps the hubs from clipping to white.
  color = color / (color + vec3(0.74)) * 1.24;
  vec2 q = uv - 0.5;
  color *= 1.0 - dot(q, q) * 0.42;

  float grain = fract(sin(dot(uv * uResolution + uTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * 0.012;
  fragColor = vec4(max(color, 0.0), 1.0);
}`;

export const SHELL_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uViewProj;
uniform vec3 uEye;

out vec3 vNormal;
out vec3 vViewDir;

void main() {
  vNormal = aNormal;
  vViewDir = normalize(uEye - aPosition);
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

export const SHELL_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vViewDir;
out vec4 fragColor;

uniform float uOpacity;

void main() {
  vec3 normal = normalize(vNormal);
  float facing = abs(dot(normal, normalize(vViewDir)));
  float fresnel = pow(1.0 - facing, 1.7);
  // A raking light picks out the gyri; the rim marks the silhouette.
  float diffuse = clamp(dot(normal, normalize(vec3(-0.5, 0.72, 0.48))), 0.0, 1.0);
  float alpha = (0.018 + 0.06 * diffuse + 0.15 * fresnel) * uOpacity;
  vec3 pale = vec3(0.2, 0.27, 0.38) + vec3(0.16, 0.2, 0.24) * diffuse;
  vec3 rim = vec3(0.78, 0.87, 1.0);
  fragColor = vec4(mix(pale, rim, fresnel), alpha);
}`;
