// Forget: the node's own rendering dissolves into grain, oldest lines (top)
// first. Grains at the edge glow faintly before they go.
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Amount
 * @default 0.4
 * @range 0, 1
 */
uniform float u_amount;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec2 cell = floor(gl_FragCoord.xy / 3.0);
	float n = noise(gl_FragCoord.xy / 90.0) * 0.7 + noise(gl_FragCoord.xy / 22.0) * 0.25 + hash(cell) * 0.05;
	// Top of the panel goes first.
	float t = n * 0.4 + (1.0 - uv.y) * 0.6;
	float cut = u_amount * 1.25 - 0.1;
	float keep = smoothstep(cut - 0.035, cut + 0.035, t);
	// Grains drift up a little as they come loose.
	vec2 drift = vec2(0.0, (1.0 - keep) * 6.0) / u_res;
	vec4 c = texture2D(u_content, uv - drift);
	float edge = exp(-pow((t - cut) * 70.0, 2.0)) * step(0.001, u_amount);
	float sparkle = step(0.995, hash(cell + floor(u_time * 4.0)));
	// Whatever is left fades a little, like an old message.
	c *= 1.0 - 0.35 * smoothstep(0.0, 0.6, u_amount);
	c.rgb += edge * c.a * vec3(0.55, 0.6, 0.7) * (0.6 + sparkle);
	gl_FragColor = c * keep + vec4(vec3(0.7) * edge * sparkle * 0.6, edge * sparkle * 0.6) * (1.0 - keep);
}
