// Shimmer: a faint diagonal light sweep with a few star glints across the
// node's own rendering (used on download buttons).
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Strength
 * @default 0.5
 * @range 0, 1
 */
uniform float u_strength;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec4 c = texture2D(u_content, uv);
	float band = fract((uv.x * u_res.x - uv.y * u_res.y * 0.6) / (u_res.x * 2.2) - u_time * 0.35);
	float sweep = exp(-pow((band - 0.5) * 18.0, 2.0));
	vec2 cell = floor(gl_FragCoord.xy / 3.0);
	float star = step(0.992, hash(cell)) * sweep;
	float lum = dot(c.rgb, vec3(0.333));
	// On white fills the sweep reads as a cool sheen, on dark ones as light.
	vec3 tint = mix(vec3(1.0), vec3(0.62, 0.68, 0.8), step(0.6, lum));
	c.rgb = mix(c.rgb, tint, sweep * 0.35 * u_strength * c.a) + star * c.a * u_strength;
	gl_FragColor = vec4(min(c.rgb, vec3(c.a)), c.a);
}
