precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/**
 * @label Background
 * @color
 * @default #000000
 */
uniform vec3 u_bg;
/**
 * @label Dot
 * @color
 * @default #171717
 */
uniform vec3 u_dot;
/**
 * @label Spacing
 * @default 16
 * @range 4, 64
 */
uniform float u_gap;
void main() {
  vec2 p = mod(gl_FragCoord.xy, u_gap) - u_gap * 0.5;
  float d = length(p);
  float a = 1.0 - smoothstep(0.6, 1.2, d);
  gl_FragColor = vec4(mix(u_bg, u_dot, a), 1.0);
}
